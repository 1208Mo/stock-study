import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
    DecisionHistoryWithPicks,
    DecisionPickReviewFront,
    DecisionStats,
} from '../types'

/** 数字格式化：价格保留 2-3 位 */
function money(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—'
    return value >= 10 ? value.toFixed(2) : value.toFixed(3)
}

/** 百分比格式化 */
function pct(value: number | null | undefined, withSign = false): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—'
    const sign = withSign && value > 0 ? '+' : ''
    return `${sign}${value.toFixed(2)}%`
}

/** 决策复盘状态徽章 */
function ReviewStatusBadge({ status }: { status: DecisionHistoryWithPicks['review_status'] }) {
    const map: Record<typeof status, { text: string; cls: string }> = {
        pending: { text: '待复盘', cls: 'dh-badge pending' },
        partial: { text: '部分复盘', cls: 'dh-badge partial' },
        reviewed: { text: '已复盘', cls: 'dh-badge reviewed' },
    }
    const item = map[status] ?? map.pending
    return <span className={item.cls}>{item.text}</span>
}

/** 市场状态徽章（从 market_regime JSON 解析；旧记录为 null 显示 —） */
function RegimeMiniBadge({ regimeJson }: { regimeJson: string | null }) {
    if (!regimeJson) return null
    let regime: string | null = null
    try {
        const parsed = JSON.parse(regimeJson) as { regime?: string }
        regime = parsed.regime ?? null
    } catch {
        return null
    }
    const map: Record<string, { text: string; cls: string }> = {
        offensive: { text: '进攻', cls: 'regime-badge offensive mini' },
        defensive: { text: '防守', cls: 'regime-badge defensive mini' },
        cash: { text: '空仓', cls: 'regime-badge cash mini' },
    }
    const item = regime ? map[regime] : null
    if (!item) return null
    return <span className={item.cls}>{item.text}</span>
}

/** 单个 pick 的命中/出场原因标签 */
function pickOutcomeLabel(pick: DecisionPickReviewFront): { text: string; cls: string } {
    if (pick.status === 'pending') return { text: '待复盘', cls: 'dh-tag pending' }
    if (pick.status === 'failed') return { text: '复盘失败', cls: 'dh-tag failed' }
    if (pick.action === 'avoid') return { text: '回避', cls: 'dh-tag avoid' }
    if (pick.entry_triggered !== 1) return { text: '未触发买入', cls: 'dh-tag miss' }
    switch (pick.exit_reason) {
        case 'take_profit':
            return { text: '止盈', cls: 'dh-tag win' }
        case 'stop_loss':
            return { text: '止损', cls: 'dh-tag loss' }
        case 'window_end':
            return { text: '窗口结束', cls: 'dh-tag neutral' }
        case 'none':
            return { text: '未触发', cls: 'dh-tag miss' }
        case 'not_applicable':
            return { text: '不适用', cls: 'dh-tag avoid' }
        default:
            return { text: pick.exit_reason ?? '未知', cls: 'dh-tag neutral' }
    }
}

interface StatsCardProps {
    label: string
    value: string
    sub?: string
    tone?: 'neutral' | 'up' | 'down'
}

function StatsCard({ label, value, sub, tone = 'neutral' }: StatsCardProps) {
    return (
        <div className={`dh-stat-card ${tone}`}>
            <div className="dh-stat-label">{label}</div>
            <div className="dh-stat-value">{value}</div>
            {sub && <div className="dh-stat-sub">{sub}</div>}
        </div>
    )
}

export default function DecisionHistory() {
    const [decisions, setDecisions] = useState<DecisionHistoryWithPicks[]>([])
    const [stats, setStats] = useState<DecisionStats | null>(null)
    const [expandedId, setExpandedId] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [reviewing, setReviewing] = useState<number | null>(null)
    const [reviewMsg, setReviewMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
    const [statsDays, setStatsDays] = useState<number>(30)
    const [error, setError] = useState('')

    const loadList = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            const list = await window.api.decision.list(60)
            setDecisions(list)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    const loadStats = useCallback(async () => {
        try {
            const s = await window.api.decision.stats(statsDays)
            setStats(s)
        } catch (e) {
            // 统计失败不阻塞列表
            setStats(null)
        }
    }, [statsDays])

    useEffect(() => {
        loadList()
        loadStats()
    }, [loadList, loadStats])

    // 命中率/胜率等聚合指标基于 stats（近 N 日）
    const statsView = useMemo(() => {
        if (!stats) return null
        const triggerRate = stats.pick_total > 0
            ? (stats.entry_triggered_count / stats.pick_total) * 100
            : 0
        const closedWinRate = stats.closed_count > 0
            ? (stats.profitable_count / stats.closed_count) * 100
            : 0
        return {
            decisionCount: stats.decision_count,
            pickTotal: stats.pick_total,
            actionable: stats.actionable_count,
            triggered: stats.entry_triggered_count,
            closed: stats.closed_count,
            profitable: stats.profitable_count,
            triggerRate,
            closedWinRate,
            avgReturn: stats.avg_return_pct,
            totalPnl: stats.total_pnl,
        }
    }, [stats])

    async function handleReview(decisionId?: number) {
        setReviewing(decisionId ?? -1) // -1 表示批量
        setReviewMsg(null)
        try {
            const r = await window.api.decision.review(decisionId)
            setReviewMsg({
                type: 'ok',
                text: decisionId
                    ? `复盘完成：成功 ${r.reviewed} 条，失败 ${r.failed} 条`
                    : `批量复盘完成：处理 ${r.decisions ?? 0} 个决策，成功 ${r.reviewed} 条，失败 ${r.failed} 条`,
            })
            await Promise.all([loadList(), loadStats()])
        } catch (e) {
            setReviewMsg({
                type: 'err',
                text: e instanceof Error ? e.message : String(e),
            })
        } finally {
            setReviewing(null)
        }
    }

    async function handleDelete(id: number) {
        if (!window.confirm('确认删除该决策及其复盘记录？此操作不可撤销。')) return
        try {
            const ok = await window.api.decision.delete(id)
            if (ok) {
                if (expandedId === id) setExpandedId(null)
                await Promise.all([loadList(), loadStats()])
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        }
    }

    function toggleExpand(id: number) {
        setExpandedId((cur) => (cur === id ? null : id))
    }

    // 倒序展示（最新在前）
    const sorted = useMemo(() => {
        return [...decisions].sort((a, b) =>
            a.decision_date < b.decision_date ? 1 : a.decision_date > b.decision_date ? -1 : 0
        )
    }, [decisions])

    return (
        <div className="decision-history-page">
            <div className="page-header">
                <div>
                    <h1>决策记忆 & 命中追踪</h1>
                    <p>记录每次 AI 决策，5 个交易日后自动复盘买入/止损/止盈触发情况。</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label className="dh-range-label">统计范围</label>
                    <select
                        className="dh-range-select"
                        value={statsDays}
                        onChange={(e) => setStatsDays(Number(e.target.value))}
                    >
                        <option value={7}>近 7 天</option>
                        <option value={30}>近 30 天</option>
                        <option value={90}>近 90 天</option>
                        <option value={365}>全部</option>
                    </select>
                    <button
                        className="btn-secondary"
                        onClick={() => handleReview(undefined)}
                        disabled={reviewing !== null}
                    >
                        {reviewing === -1 ? '批量复盘中...' : '批量复盘待办'}
                    </button>
                    <button className="btn-primary" onClick={loadList} disabled={loading}>
                        {loading ? '刷新中...' : '刷新'}
                    </button>
                </div>
            </div>

            {/* 汇总统计卡片 */}
            {statsView && (
                <section className="dh-stats-grid">
                    <StatsCard
                        label="决策数"
                        value={String(statsView.decisionCount)}
                        sub={`共 ${statsView.pickTotal} 个标的，可操作 ${statsView.actionable}`}
                    />
                    <StatsCard
                        label="买入命中率"
                        value={pct(statsView.triggerRate)}
                        sub={`触发 ${statsView.triggered} / ${statsView.pickTotal}`}
                        tone={statsView.triggerRate >= 50 ? 'up' : 'neutral'}
                    />
                    <StatsCard
                        label="止盈胜率"
                        value={statsView.closed > 0 ? pct(statsView.closedWinRate) : '—'}
                        sub={`已平仓 ${statsView.closed}，盈利 ${statsView.profitable}`}
                        tone={statsView.closedWinRate >= 50 ? 'up' : 'down'}
                    />
                    <StatsCard
                        label="平均收益"
                        value={pct(statsView.avgReturn, true)}
                        sub="按触发买入价计算"
                        tone={
                            statsView.avgReturn === null
                                ? 'neutral'
                                : statsView.avgReturn >= 0
                                  ? 'up'
                                  : 'down'
                        }
                    />
                    <StatsCard
                        label="累计模拟盈亏"
                        value={`¥ ${statsView.totalPnl.toFixed(2)}`}
                        sub="按仓位金额模拟"
                        tone={statsView.totalPnl >= 0 ? 'up' : 'down'}
                    />
                </section>
            )}

            {reviewMsg && (
                <div className={reviewMsg.type === 'ok' ? 'dh-ok-msg' : 'error-msg'}>
                    {reviewMsg.text}
                </div>
            )}
            {error && <div className="error-msg">{error}</div>}

            {/* 决策列表 */}
            <section className="decision-panel dh-list-panel">
                {loading && decisions.length === 0 && (
                    <div className="decision-hint">加载中...</div>
                )}
                {!loading && decisions.length === 0 && !error && (
                    <div className="empty-state compact">
                        暂无决策记录。在「每日 AI 决策」页面生成计划后会自动保存到这里。
                    </div>
                )}

                <div className="dh-list">
                    {sorted.map((d) => {
                        const expanded = expandedId === d.id
                        const pickCount = d.picks.length
                        const triggered = d.picks.filter((p) => p.entry_triggered === 1).length
                        const wins = d.picks.filter(
                            (p) => p.exit_reason === 'take_profit'
                        ).length
                        const losses = d.picks.filter(
                            (p) => p.exit_reason === 'stop_loss'
                        ).length
                        const pnl = d.picks.reduce((sum, p) => sum + (p.pnl_amount ?? 0), 0)
                        const hasPending = pickCount > 0 && d.picks.some((p) => p.status === 'pending')

                        return (
                            <div key={d.id} className={`dh-item ${expanded ? 'expanded' : ''}`}>
                                <div
                                    className="dh-item-header"
                                    onClick={() => toggleExpand(d.id)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            toggleExpand(d.id)
                                        }
                                    }}
                                >
                                    <div className="dh-item-date">
                                        <span className="dh-date-text">{d.decision_date}</span>
                                        <ReviewStatusBadge status={d.review_status} />
                                        <RegimeMiniBadge regimeJson={d.market_regime} />
                                        {d.risk_level && (
                                            <span className="dh-meta-tag">{d.risk_level}</span>
                                        )}
                                        {d.capital !== null && (
                                            <span className="dh-meta-tag">
                                                ¥{d.capital.toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="dh-item-summary">
                                        {pickCount === 0 ? (
                                            <span className="dh-summary-empty">
                                                当日无结构化标的
                                            </span>
                                        ) : (
                                            <>
                                                <span className="dh-summary-bit">
                                                    标的 {pickCount}
                                                </span>
                                                <span className="dh-summary-bit up">
                                                    命中 {triggered}
                                                </span>
                                                {wins > 0 && (
                                                    <span className="dh-summary-bit up">
                                                        止盈 {wins}
                                                    </span>
                                                )}
                                                {losses > 0 && (
                                                    <span className="dh-summary-bit down">
                                                        止损 {losses}
                                                    </span>
                                                )}
                                                <span
                                                    className={`dh-summary-bit ${pnl >= 0 ? 'up' : 'down'}`}
                                                >
                                                    {pct(
                                                        d.picks.length > 0
                                                            ? d.picks.reduce(
                                                                  (s, p) =>
                                                                      s + (p.return_pct ?? 0),
                                                                  0
                                                              ) / d.picks.length
                                                            : null,
                                                        true
                                                    )}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    <div className="dh-item-actions">
                                        {hasPending && (
                                            <button
                                                className="btn-small"
                                                disabled={reviewing === d.id}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleReview(d.id)
                                                }}
                                            >
                                                {reviewing === d.id ? '复盘中...' : '立即复盘'}
                                            </button>
                                        )}
                                        <button
                                            className="btn-small danger"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleDelete(d.id)
                                            }}
                                        >
                                            删除
                                        </button>
                                        <span className={`dh-chevron ${expanded ? 'open' : ''}`}>
                                            ▸
                                        </span>
                                    </div>
                                </div>

                                {expanded && (
                                    <div className="dh-item-body">
                                        {pickCount > 0 && (
                                            <div className="dh-pick-table">
                                                <div className="dh-pick-row header">
                                                    <span>标的</span>
                                                    <span>动作</span>
                                                    <span>买入价</span>
                                                    <span>止损</span>
                                                    <span>止盈</span>
                                                    <span>仓位</span>
                                                    <span>触发</span>
                                                    <span>出场</span>
                                                    <span>收益</span>
                                                    <span>盈亏</span>
                                                </div>
                                                {d.picks
                                                    .slice()
                                                    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
                                                    .map((p) => {
                                                        const outcome = pickOutcomeLabel(p)
                                                        return (
                                                            <div
                                                                className="dh-pick-row"
                                                                key={p.id}
                                                            >
                                                                <span className="dh-pick-name">
                                                                    {p.code} {p.name}
                                                                    {p.priority !== null && (
                                                                        <em className="dh-priority">
                                                                            #{p.priority}
                                                                        </em>
                                                                    )}
                                                                </span>
                                                                <span>
                                                                    {p.action === 'watch'
                                                                        ? '观察'
                                                                        : p.action === 'avoid'
                                                                          ? '回避'
                                                                          : '—'}
                                                                </span>
                                                                <span>
                                                                    {money(p.entry_price ?? p.aggressive_entry ?? p.conservative_entry)}
                                                                </span>
                                                                <span>{money(p.stop_loss)}</span>
                                                                <span>{money(p.take_profit)}</span>
                                                                <span>
                                                                    {p.position_amount !== null
                                                                        ? `¥${p.position_amount}`
                                                                        : '—'}
                                                                </span>
                                                                <span>
                                                                    {p.entry_triggered === 1 ? (
                                                                        <span className="up">
                                                                            ✓ {p.entry_date?.slice(5) ?? ''}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-muted">—</span>
                                                                    )}
                                                                </span>
                                                                <span>
                                                                    <span className={outcome.cls}>
                                                                        {outcome.text}
                                                                    </span>
                                                                    {p.exit_date && (
                                                                        <span className="dh-exit-date">
                                                                            {p.exit_date.slice(5)}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                <span
                                                                    className={
                                                                        p.return_pct === null
                                                                            ? 'text-muted'
                                                                            : p.return_pct >= 0
                                                                              ? 'up'
                                                                              : 'down'
                                                                    }
                                                                >
                                                                    {pct(p.return_pct, true)}
                                                                </span>
                                                                <span
                                                                    className={
                                                                        p.pnl_amount === null
                                                                            ? 'text-muted'
                                                                            : p.pnl_amount >= 0
                                                                              ? 'up'
                                                                              : 'down'
                                                                    }
                                                                >
                                                                    {p.pnl_amount !== null
                                                                        ? `¥${p.pnl_amount.toFixed(2)}`
                                                                        : '—'}
                                                                </span>
                                                            </div>
                                                        )
                                                    })}
                                            </div>
                                        )}

                                        {d.market_context && (
                                            <details className="dh-md-block">
                                                <summary>市场背景</summary>
                                                <div className="markdown-body">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {d.market_context}
                                                    </ReactMarkdown>
                                                </div>
                                            </details>
                                        )}
                                        {d.decision_text && (
                                            <details className="dh-md-block">
                                                <summary>原始决策文本</summary>
                                                <div className="markdown-body">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {d.decision_text}
                                                    </ReactMarkdown>
                                                </div>
                                            </details>
                                        )}
                                        {d.diagnostics && (
                                            <details className="dh-md-block">
                                                <summary>Agent 诊断信息</summary>
                                                <pre className="dh-pre">
                                                    {(() => {
                                                        try {
                                                            return JSON.stringify(
                                                                JSON.parse(d.diagnostics),
                                                                null,
                                                                2
                                                            )
                                                        } catch {
                                                            return d.diagnostics
                                                        }
                                                    })()}
                                                </pre>
                                            </details>
                                        )}
                                        {d.picks.some((p) => p.error_msg) && (
                                            <div className="warn-msg">
                                                复盘错误：
                                                {d.picks
                                                    .filter((p) => p.error_msg)
                                                    .map((p) => `${p.code}: ${p.error_msg}`)
                                                    .join('；')}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </section>

            <div className="disclaimer-box">
                命中追踪基于决策日之后 5 个交易日的日K线模拟，采用保守口径（同日双触发按止损优先），不包含盘中滑点与税费，仅供复盘参考。
            </div>
        </div>
    )
}
