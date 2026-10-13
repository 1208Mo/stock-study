import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useChartTheme } from '../utils/chartTheme'
import { Tooltip } from './Tooltip'
import type { DecisionScorecard, ScorecardSlice } from '../types'

interface Props {
    data: DecisionScorecard | null
}

function pct(v: number | null, digits = 0) {
    return v === null ? '—' : `${v.toFixed(digits)}%`
}
function signedPct(v: number | null, digits = 2) {
    return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}
function trend(v: number | null) {
    return v === null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : ''
}

/** 一组切片：胜率条 + 平均收益 */
function SliceGroup({
    title,
    hint,
    slices,
    emptyText,
}: {
    title: string
    hint: string
    slices: ScorecardSlice[]
    emptyText: string
}) {
    const valid = slices.filter((s) => s.closed > 0)
    return (
        <div className="sc-group">
            <Tooltip content={hint}>
                <h4>{title}</h4>
            </Tooltip>
            {valid.length === 0 ? (
                <div className="dash-muted sc-empty">{emptyText}</div>
            ) : (
                <div className="sc-rows">
                    {valid.map((s) => (
                        <div className="sc-row" key={s.key}>
                            <span className="sc-row-label" title={s.label}>
                                {s.label}
                            </span>
                            <div className="sc-bar">
                                <div
                                    className={`sc-bar-fill ${(s.winRate ?? 0) >= 50 ? 'up' : 'down'}`}
                                    style={{ width: `${Math.max(2, s.winRate ?? 0)}%` }}
                                />
                            </div>
                            <span className="sc-row-win">{pct(s.winRate)}</span>
                            <span className={`sc-row-ret ${trend(s.avgReturnPct)}`}>
                                {signedPct(s.avgReturnPct)}
                            </span>
                            <span className="sc-row-n dash-muted">{s.closed} 笔</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function ScorecardPanel({ data }: Props) {
    const theme = useChartTheme()

    // 离场原因分布：看清是被止损打出来的多，还是真的止盈走的多
    const exitOption = useMemo(() => {
        if (!data) return null
        const rows = data.byExitReason.filter((s) => s.key !== 'not_applicable' && s.actionable + s.triggered > 0)
        if (rows.length === 0) return null
        const colorOf = (key: string) =>
            key === 'take_profit' ? theme.up : key === 'stop_loss' ? theme.down : theme.axis
        return {
            tooltip: { trigger: 'item', formatter: '{b}：{c} 次（{d}%）' },
            series: [
                {
                    type: 'pie',
                    radius: ['45%', '70%'],
                    label: { color: theme.text, fontSize: 11, formatter: '{b}\n{d}%' },
                    labelLine: { lineStyle: { color: theme.axisLine } },
                    data: rows.map((s) => ({
                        name: s.label,
                        value: Math.max(s.triggered, s.closed) || s.actionable,
                        itemStyle: { color: colorOf(s.key) },
                    })),
                },
            ],
        }
    }, [data, theme])

    if (!data) return <div className="dash-skeleton" style={{ height: 220 }} />

    const o = data.overall
    if (o.closed === 0) {
        return (
            <div className="dash-card dash-empty">
                <span>还没有完成复盘的推荐</span>
                <span className="dash-muted">
                    AI 给出计划后，第 5 个交易日会自动复盘。积累几条之后，这里会显示它在什么情况下靠得住
                </span>
            </div>
        )
    }

    const priorityInsight = (() => {
        const first = data.byPriority.find((s) => s.key === '1' && s.closed >= 2)
        const rest = data.byPriority.filter((s) => s.key !== '1' && s.closed >= 2)
        if (!first || rest.length === 0) return null
        const restWin =
            rest.reduce((a, s) => a + (s.winRate ?? 0) * s.closed, 0) / rest.reduce((a, s) => a + s.closed, 0)
        const diff = (first.winRate ?? 0) - restWin
        return diff >= 5
            ? `排序有效：第 1 推荐胜率比靠后推荐高 ${diff.toFixed(0)} 个百分点，可以更重视头名。`
            : diff <= -5
              ? `排序存疑：第 1 推荐胜率比靠后推荐低 ${Math.abs(diff).toFixed(0)} 个百分点，不要盲目只看头名。`
              : '第 1 推荐和靠后推荐胜率接近，排序暂时看不出区分度。'
    })()

    return (
        <div className="sc-wrap">
            <div className="sc-headline">
                <div className="sc-headline-main">
                    <span className="dash-asset-label">近 {data.days} 天 AI 战绩</span>
                    <span className="sc-headline-value">
                        胜率 <strong className={(o.winRate ?? 0) >= 50 ? 'up' : 'down'}>{pct(o.winRate)}</strong>
                        <span className="dash-muted"> · </span>
                        平均收益{' '}
                        <strong className={trend(o.avgReturnPct)}>{signedPct(o.avgReturnPct)}</strong>
                    </span>
                    <span className="dash-muted">
                        可执行 {o.actionable} 条 · 触发入场 {o.triggered} 条 · 已复盘 {o.closed} 条 · 模拟盈亏{' '}
                        <span className={trend(o.totalPnl)}>
                            {o.totalPnl > 0 ? '+' : ''}
                            {o.totalPnl.toFixed(0)} 元
                        </span>
                    </span>
                </div>
                {priorityInsight && <div className="sc-insight">{priorityInsight}</div>}
            </div>

            <div className="sc-grid">
                <SliceGroup
                    title="按大盘状态"
                    hint="AI 在不同市场环境下的表现。某种状态下胜率明显低，说明那种环境下它的判断不可靠，应该降低仓位"
                    slices={data.byRegime}
                    emptyText="还没有跨不同市场状态的样本"
                />
                <SliceGroup
                    title="按推荐排序"
                    hint="检验 AI 的排序能力：第 1 推荐是否真的比第 3 推荐更靠谱"
                    slices={data.byPriority}
                    emptyText="样本不足"
                />
                <SliceGroup
                    title="按入场方式"
                    hint="激进价是追着买，保守价是等回调。看哪种口径在实际行情里更容易赚到钱"
                    slices={data.byEntryType}
                    emptyText="样本不足"
                />
                <div className="sc-group">
                    <Tooltip content="止损占比高说明入场价太激进或止损设得太紧；窗口末收盘占比高说明行情没按预期走，不涨不跌">
                        <h4>离场原因分布</h4>
                    </Tooltip>
                    {exitOption ? (
                        <ReactECharts option={exitOption} style={{ height: 180 }} notMerge />
                    ) : (
                        <div className="dash-muted sc-empty">样本不足</div>
                    )}
                </div>
            </div>

            {data.byStock.filter((s) => s.closed > 0).length > 0 && (
                <SliceGroup
                    title="按个股"
                    hint="反复推荐却反复亏钱的票，说明 AI 对它有系统性误判，可以让它别再推"
                    slices={data.byStock}
                    emptyText="样本不足"
                />
            )}

            <div className="sc-feedback dash-muted">
                这份战绩会在每次生成每日计划时注入 AI 的提示词，让它根据自己过去的对错调整仓位和取舍。
            </div>
        </div>
    )
}
