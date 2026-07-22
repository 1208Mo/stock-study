import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import ReactECharts from 'echarts-for-react'
import type {
    DailyDecisionCandidate,
    QuoteData,
    KLineData,
    StructuredDecision,
    AgentDiagnostics,
} from '../types'

type RiskLevel = '稳一点' | '平衡' | '激进'

function money(value: number) {
    if (!value || value === 0) return '—'
    return value >= 10 ? value.toFixed(2) : value.toFixed(3)
}

function optionalMoney(value: number | null) {
    return value === null ? '—' : money(value)
}

function calcCandidate(quote: QuoteData): DailyDecisionCandidate {
    const isEtf =
        quote.name.includes('ETF') || quote.code.startsWith('5') || quote.code.startsWith('1')
    const highChange = isEtf ? 2.5 : 4
    const severeDrop = isEtf ? -4 : -7
    const aggressiveFactor = isEtf ? 0.995 : 0.99
    const conservativeFactor = isEtf ? 0.985 : 0.975
    const stopFactor = isEtf ? 0.97 : 0.965
    const takeProfitFactor = isEtf ? 1.025 : 1.04

    let noBuyReason: string | null = null
    if (quote.changePercent >= highChange) {
        noBuyReason = `今日已涨 ${quote.changePercent.toFixed(2)}%，不追高`
    } else if (quote.changePercent <= severeDrop) {
        noBuyReason = `今日跌幅 ${quote.changePercent.toFixed(2)}%，先等止跌`
    } else if (quote.price >= quote.high * 0.992) {
        noBuyReason = '接近日内高点，等回踩'
    }

    return {
        code: quote.code,
        name: quote.name,
        price: quote.price,
        changePercent: quote.changePercent,
        aggressiveEntry: Number((quote.price * aggressiveFactor).toFixed(3)),
        conservativeEntry: Number((quote.price * conservativeFactor).toFixed(3)),
        stopLoss: Number((quote.price * stopFactor).toFixed(3)),
        takeProfit: Number((quote.price * takeProfitFactor).toFixed(3)),
        noBuyReason,
        high: quote.high,
        low: quote.low,
        open: quote.open,
        volume: quote.volume,
    }
}

function pickRuleBased(
    candidates: DailyDecisionCandidate[],
    capital: number,
    riskLevel: RiskLevel
) {
    const available = candidates.filter((item) => !item.noBuyReason)
    const sorted = [...available].sort((a, b) => {
        const aEtf = a.name.includes('ETF') || a.code.startsWith('5') || a.code.startsWith('1')
        const bEtf = b.name.includes('ETF') || b.code.startsWith('5') || b.code.startsWith('1')
        if (riskLevel === '稳一点' && aEtf !== bEtf) return aEtf ? -1 : 1
        const aScore = Math.abs(a.changePercent) <= 1.5 ? 2 : a.changePercent > 0 ? 1 : 0
        const bScore = Math.abs(b.changePercent) <= 1.5 ? 2 : b.changePercent > 0 ? 1 : 0
        return bScore - aScore
    })
    const picks = sorted.slice(0, riskLevel === '稳一点' ? 1 : 3)

    if (picks.length === 0) {
        return '今天候选池都不太适合傻瓜式买入。先空着，等回踩或板块重新走强。'
    }

    const safeCapital = isNaN(capital) || capital <= 0 ? 5000 : capital
    const position =
        riskLevel === '激进'
            ? Math.round(safeCapital * 0.25)
            : riskLevel === '平衡'
              ? Math.round(safeCapital * 0.2)
              : Math.round(safeCapital * 0.15)

    return picks
        .map(
            (item) =>
                `${item.code} ${item.name}\n` +
                `买入价：激进 ${money(item.aggressiveEntry)}，保守 ${money(item.conservativeEntry)}\n` +
                `止损线：${money(item.stopLoss)}；第一止盈：${money(item.takeProfit)}\n` +
                `仓位：${position} 元左右\n` +
                `不买条件：开盘直线拉升、接近日内高点、板块冲高回落`
        )
        .join('\n\n')
}

// 读写 localStorage 的小工具
function loadPref<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(`decision_pref_${key}`)
        if (raw === null) return fallback
        return JSON.parse(raw) as T
    } catch {
        return fallback
    }
}
function savePref(key: string, value: unknown) {
    try {
        localStorage.setItem(`decision_pref_${key}`, JSON.stringify(value))
    } catch {}
}

export default function DailyDecision() {
    const [capital, setCapital] = useState(() => loadPref<number>('capital', 7000))
    const [capitalInput, setCapitalInput] = useState(() =>
        String(loadPref<number>('capital', 7000))
    )
    const [riskLevel, setRiskLevel] = useState<RiskLevel>(() =>
        loadPref<RiskLevel>('riskLevel', '平衡')
    )
    const [input, setInput] = useState(() => loadPref<string>('input', ''))
    const [candidates, setCandidates] = useState<DailyDecisionCandidate[]>([])
    const [failedCodes, setFailedCodes] = useState<string[]>([])
    const [ruleResult, setRuleResult] = useState('')
    const [aiResult, setAiResult] = useState('')
    const [marketContext, setMarketContext] = useState('')
    const [structuredDecision, setStructuredDecision] = useState<StructuredDecision | null>(null)
    const [agentDiagnostics, setAgentDiagnostics] = useState<AgentDiagnostics | null>(null)
    const [loading, setLoading] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [loadingStep, setLoadingStep] = useState('')
    const [error, setError] = useState('')
    const [useAgent, setUseAgent] = useState(() => loadPref<boolean>('useAgent', false))

    // 实时候选池（从东方财富领涨板块动态拉取）
    const [dynamicPool, setDynamicPool] = useState<{ code: string; name: string }[]>([])
    const [poolLoading, setPoolLoading] = useState(false)
    const [poolError, setPoolError] = useState('')

    // 热门板块近7日趋势
    const [sectorTrends, setSectorTrends] = useState<
        Array<{ name: string; code: string; changePercent: number; klines: KLineData[] }>
    >([])
    const [sectorLoading, setSectorLoading] = useState(false)

    // 手动输入解析
    const parsed = useMemo(() => {
        const seen = new Set<string>()
        return input
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const codeMatch = line.match(/\b\d{6}\b/)
                if (!codeMatch) return null
                const code = codeMatch[0]
                if (seen.has(code)) return null
                seen.add(code)
                const name =
                    line
                        .replace(code, '')
                        .replace(/[|,，：:]/g, '')
                        .trim() || code
                return { code, name }
            })
            .filter((item): item is { code: string; name: string } => Boolean(item))
    }, [input])

    // 手动输入优先，否则用实时动态池
    const activePool = parsed.length > 0 ? parsed : dynamicPool

    // 页面加载时自动拉取实时候选池
    async function loadDynamicPool() {
        setPoolLoading(true)
        setPoolError('')
        try {
            const pool = await window.api.market.getDynamicCandidates(5, 4)
            setDynamicPool(pool)
        } catch (e) {
            setPoolError('实时候选池加载失败，可手动输入股票代码')
        } finally {
            setPoolLoading(false)
        }
    }

    async function loadSectorTrends() {
        setSectorLoading(true)
        try {
            const sectors = await window.api.market.getTopSectors(8)
            const results = await Promise.allSettled(
                sectors.map(async (s) => {
                    const klines = await window.api.market.getSectorKLine(s.code, 7).catch(() => [])
                    return { name: s.name, code: s.code, changePercent: s.changePercent, klines }
                })
            )
            setSectorTrends(
                results
                    .filter(
                        (
                            r
                        ): r is PromiseFulfilledResult<
                            (typeof results)[0] extends PromiseFulfilledResult<infer T> ? T : never
                        > => r.status === 'fulfilled'
                    )
                    .map((r) => r.value)
                    .filter((s) => s.klines.length > 0)
            )
        } catch {
            // silent
        } finally {
            setSectorLoading(false)
        }
    }

    useEffect(() => {
        loadDynamicPool()
        loadSectorTrends()
    }, [])

    function handleCapitalChange(e: React.ChangeEvent<HTMLInputElement>) {
        const raw = e.target.value
        setCapitalInput(raw)
        const num = Number(raw)
        if (!isNaN(num) && num >= 0) {
            setCapital(num)
            savePref('capital', num)
        }
    }

    async function handleRefreshQuotes() {
        if (candidates.length === 0) return
        setRefreshing(true)
        try {
            const codes = candidates.map((c) => c.code)
            const quotes = await window.api.market.getBatchQuotes(codes)
            const calculated = quotes.map(calcCandidate)
            setCandidates(calculated)
        } catch {
            // silent fail
        } finally {
            setRefreshing(false)
        }
    }

    async function handleGenerate() {
        const safeCapital = isNaN(capital) || capital <= 0 ? 5000 : capital
        setLoading(true)
        setError('')
        setAiResult('')
        setMarketContext('')
        setStructuredDecision(null)
        setAgentDiagnostics(null)
        setRuleResult('')
        setFailedCodes([])

        try {
            // ── Agent 模式（LangGraph）────────────────────────────────────────────
            if (useAgent) {
                setLoadingStep('Agent 启动中（拉新闻 → 分析市场 → 拉行情 → AI决策）...')
                const today = new Date().toISOString().slice(0, 10)
                const result = await window.api.ai.agentDecision({
                    date: today,
                    candidateCodes: activePool, // 可以为空，agent 会基于新闻自行分析
                    capital: safeCapital,
                    riskLevel,
                })
                setMarketContext(result.marketContext)
                setAiResult(result.decision)
                setStructuredDecision(result.structuredDecision)
                setAgentDiagnostics(result.diagnostics)
                if (result.quotes && result.quotes.length > 0) {
                    setCandidates(result.quotes.map(calcCandidate))
                }
                return
            }

            // ── 经典流程 ─────────────────────────────────────────────────────────
            setLoadingStep('正在获取今日市场热点...')
            let headlines: string[] = []
            let topSectors: Array<{ name: string; changePercent: number }> = []
            try {
                headlines = await window.api.market.getNews(25)
            } catch {
                headlines = []
            }
            try {
                topSectors = await window.api.market.getTopSectors(12)
            } catch {
                topSectors = []
            }

            let marketContextResult = ''
            if (headlines.length > 0 || topSectors.length > 0) {
                setLoadingStep('AI 分析今日市场逻辑...')
                try {
                    const today = new Date().toISOString().slice(0, 10)
                    const ctxResult = await window.api.ai.marketContext({
                        news: headlines,
                        date: today,
                        topSectors,
                    })
                    marketContextResult = ctxResult.content
                    setMarketContext(marketContextResult)
                } catch {
                    // 市场分析失败不影响后续
                }
            }

            // 候选池为空时，直接让 AI 基于市场背景给出建议，跳过行情拉取
            if (activePool.length === 0) {
                setLoadingStep('AI 生成交易计划...')
                try {
                    const ai = await window.api.ai.dailyDecision({
                        capital: safeCapital,
                        riskLevel,
                        focus: '今日领涨板块',
                        candidates: [],
                    })
                    setAiResult(ai.content)
                } catch (aiError) {
                    const message = aiError instanceof Error ? aiError.message : String(aiError)
                    setAiResult(`未调用AI：${message}`)
                }
                return
            }

            setLoadingStep('获取候选池行情...')
            const requestedCodes = activePool.map((item) => item.code)
            const quotes = await window.api.market.getBatchQuotes(requestedCodes)
            const returnedCodes = new Set(quotes.map((q) => q.code))
            const failed = requestedCodes.filter((c) => !returnedCodes.has(c))
            setFailedCodes(failed)

            if (quotes.length === 0) {
                setCandidates([])
                setRuleResult(
                    `行情接口暂时无法访问，以下候选池价位需以你的交易软件实时价 P 手动计算：\n\n` +
                        activePool
                            .map(
                                (item) =>
                                    `${item.code} ${item.name}\n激进挂：P × 0.990　保守挂：P × 0.975\n止损：买入价 × 0.963　第一止盈：买入价 × 1.04`
                            )
                            .join('\n\n')
                )
                setAiResult('行情数据全部获取失败，跳过 AI 分析。请检查网络后重试。')
                return
            }

            const calculated = quotes.map(calcCandidate)
            setCandidates(calculated)
            setRuleResult(pickRuleBased(calculated, safeCapital, riskLevel))

            setLoadingStep('AI 生成交易计划...')
            try {
                const ai = await window.api.ai.dailyDecision({
                    capital: safeCapital,
                    riskLevel,
                    focus: '今日领涨板块',
                    candidates: calculated,
                })
                setAiResult(ai.content)
            } catch (aiError) {
                const message = aiError instanceof Error ? aiError.message : String(aiError)
                setAiResult(`未调用AI：${message}\n\n已先生成本地规则版计划。`)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
            setLoadingStep('')
        }
    }

    return (
        <div className="daily-decision-page">
            <div className="page-header">
                <div>
                    <h1>每日 AI 决策</h1>
                    <p>候选池实时从今日领涨板块自动获取，也可手动输入覆盖。</p>
                </div>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 8,
                    }}
                >
                    <div className="agent-mode-toggle">
                        <span className="agent-mode-label">模式：</span>
                        <button
                            className={`btn-day ${!useAgent ? 'active' : ''}`}
                            onClick={() => {
                                setUseAgent(false)
                                savePref('useAgent', false)
                            }}
                        >
                            经典
                        </button>
                        <button
                            className={`btn-day ${useAgent ? 'active' : ''}`}
                            onClick={() => {
                                setUseAgent(true)
                                savePref('useAgent', true)
                            }}
                        >
                            🤖 Agent
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {candidates.length > 0 && (
                            <button
                                className="btn-secondary"
                                onClick={handleRefreshQuotes}
                                disabled={refreshing || loading}
                            >
                                {refreshing ? '刷新中...' : '刷新报价'}
                            </button>
                        )}
                        <button className="btn-primary" onClick={handleGenerate} disabled={loading}>
                            {loading ? loadingStep || '分析中...' : '生成今日计划'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="decision-layout">
                <section className="decision-panel">
                    <h3>参数</h3>
                    <label>可用资金</label>
                    <input
                        value={capitalInput}
                        type="number"
                        min={0}
                        onChange={handleCapitalChange}
                    />

                    <label>风险偏好</label>
                    <div className="risk-selector">
                        {(['稳一点', '平衡', '激进'] as RiskLevel[]).map((item) => (
                            <button
                                key={item}
                                className={`btn-day ${riskLevel === item ? 'active' : ''}`}
                                onClick={() => {
                                    setRiskLevel(item)
                                    savePref('riskLevel', item)
                                }}
                            >
                                {item}
                            </button>
                        ))}
                    </div>

                    <div className="candidate-label-row">
                        <label>实时候选池（今日领涨板块）</label>
                        <button
                            className="btn-small"
                            onClick={loadDynamicPool}
                            disabled={poolLoading}
                        >
                            {poolLoading ? '加载中...' : '刷新候选池'}
                        </button>
                    </div>
                    {poolError && <div className="warn-msg">{poolError}</div>}
                    {!poolError && (
                        <div className="decision-hint" style={{ marginBottom: 4 }}>
                            {poolLoading
                                ? '正在从东方财富领涨板块拉取...'
                                : dynamicPool.length > 0
                                  ? `已加载 ${dynamicPool.length} 只实时候选股（今日领涨板块涨幅前排）`
                                  : '候选池为空'}
                        </div>
                    )}

                    <div className="candidate-label-row">
                        <label>手动覆盖（可选）</label>
                    </div>
                    <textarea
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value)
                            savePref('input', e.target.value)
                        }}
                        rows={6}
                        placeholder="每行一个：002472 双环传动&#10;填入后将覆盖上方实时候选池"
                    />
                    <div className="decision-hint">
                        当前将分析 {activePool.length} 个代码（
                        {parsed.length > 0 ? '手动输入' : '实时候选池'}）。AI Key
                        未配置时也会生成本地规则版。
                    </div>
                </section>

                <section className="decision-panel decision-result">
                    <h3>傻瓜式计划</h3>
                    {error && <div className="error-msg">{error}</div>}
                    {failedCodes.length > 0 && (
                        <div className="warn-msg">
                            行情获取失败（{failedCodes.length} 个）：{failedCodes.join('、')}
                            ，以下计划仅基于成功拉取的标的。
                        </div>
                    )}
                    {!aiResult && !marketContext && !error && (
                        <div className="empty-state compact">点击生成今日计划</div>
                    )}
                    {marketContext && (
                        <div className="decision-block market-context-block markdown-body">
                            <h4>📰 今日市场逻辑（AI 基于实时快讯分析）</h4>
                            <ReactMarkdown>{marketContext}</ReactMarkdown>
                        </div>
                    )}
                    {agentDiagnostics && (
                        <div className="decision-block">
                            <h4>Agent 运行轨迹</h4>
                            <div className="decision-hint" style={{ marginBottom: 8 }}>
                                行情成功 {agentDiagnostics.quoteCount} 个；过滤后有效{' '}
                                {agentDiagnostics.filteredQuoteCount} 个；自动发现{' '}
                                {agentDiagnostics.discoveredCandidates.length} 个候选。
                            </div>
                            {agentDiagnostics.workflowNotes.length > 0 && (
                                <ul className="decision-hint" style={{ marginTop: 0 }}>
                                    {agentDiagnostics.workflowNotes.map((item, idx) => (
                                        <li key={`workflow-${idx}`}>{item}</li>
                                    ))}
                                </ul>
                            )}
                            {agentDiagnostics.filterNotes.length > 0 && (
                                <div className="warn-msg" style={{ marginTop: 8 }}>
                                    技术过滤：{agentDiagnostics.filterNotes.join('；')}
                                </div>
                            )}
                            {agentDiagnostics.riskWarnings.length > 0 && (
                                <div className="warn-msg" style={{ marginTop: 8 }}>
                                    风控提示：{agentDiagnostics.riskWarnings.join('；')}
                                </div>
                            )}
                            {agentDiagnostics.validationIssues.length > 0 && (
                                <div className="error-msg" style={{ marginTop: 8 }}>
                                    校验问题：{agentDiagnostics.validationIssues.join('；')}
                                </div>
                            )}
                        </div>
                    )}
                    {structuredDecision && (
                        <div className="decision-block">
                            <h4>结构化结果</h4>
                            <div className="decision-hint" style={{ marginBottom: 8 }}>
                                {structuredDecision.summary}；单标的最大仓位{' '}
                                {structuredDecision.maxPositionPerTarget} 元
                            </div>
                            {structuredDecision.picks.length === 0 ? (
                                <div className="warn-msg">
                                    建议观望：
                                    {structuredDecision.observeReason || '暂无明确优势标的'}
                                </div>
                            ) : (
                                <div className="candidate-table">
                                    <div className="candidate-row header">
                                        <span>优先级</span>
                                        <span>标的</span>
                                        <span>动作</span>
                                        <span>激进挂</span>
                                        <span>保守挂</span>
                                        <span>止损</span>
                                        <span>止盈</span>
                                        <span>仓位</span>
                                    </div>
                                    {[...structuredDecision.picks]
                                        .sort((a, b) => a.priority - b.priority)
                                        .map((item) => (
                                            <div
                                                className="candidate-row"
                                                key={`${item.code}-${item.priority}`}
                                            >
                                                <span>{item.priority}</span>
                                                <span>
                                                    {item.code} {item.name}
                                                </span>
                                                <span>
                                                    {item.action === 'watch' ? '观察' : '回避'}
                                                </span>
                                                <span>{optionalMoney(item.aggressiveEntry)}</span>
                                                <span>{optionalMoney(item.conservativeEntry)}</span>
                                                <span>{optionalMoney(item.stopLoss)}</span>
                                                <span>{optionalMoney(item.takeProfit)}</span>
                                                <span>{item.positionAmount} 元</span>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    )}
                    {aiResult && (
                        <div className="decision-block markdown-body">
                            <h4>AI 决策版</h4>
                            <ReactMarkdown>{aiResult}</ReactMarkdown>
                        </div>
                    )}
                </section>
            </div>

            {candidates.length > 0 && (
                <section className="decision-panel candidate-table-wrap">
                    <h3>
                        候选池报价与价位
                        <button
                            className="btn-small"
                            style={{ marginLeft: 10, fontWeight: 'normal' }}
                            onClick={handleRefreshQuotes}
                            disabled={refreshing || loading}
                        >
                            {refreshing ? '刷新中...' : '刷新报价'}
                        </button>
                    </h3>
                    <div className="candidate-table">
                        <div className="candidate-row header">
                            <span>标的</span>
                            <span>现价</span>
                            <span>涨跌幅</span>
                            <span>激进挂</span>
                            <span>保守挂</span>
                            <span>止损</span>
                            <span>止盈</span>
                            <span>状态</span>
                        </div>
                        {candidates.map((item, idx) => (
                            <div className="candidate-row" key={`${item.code}-${idx}`}>
                                <span>
                                    {item.code} {item.name}
                                </span>
                                <span>{money(item.price)}</span>
                                <span className={item.changePercent >= 0 ? 'up' : 'down'}>
                                    {item.changePercent.toFixed(2)}%
                                </span>
                                <span>{money(item.aggressiveEntry)}</span>
                                <span>{money(item.conservativeEntry)}</span>
                                <span>{money(item.stopLoss)}</span>
                                <span>{money(item.takeProfit)}</span>
                                <span>{item.noBuyReason ?? '可观察'}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <div className="disclaimer-box">
                本页面只做研究辅助，不构成投资建议。价位基于当前行情自动计算，盘中跳水、冲高回落、板块转弱时应优先执行不买条件。
            </div>

            {/* 热门板块近7日趋势 */}
            <section className="sector-trend-section">
                <div className="sector-trend-header">
                    <h3>热门板块近7日趋势</h3>
                    <button
                        className="btn-small"
                        onClick={loadSectorTrends}
                        disabled={sectorLoading}
                    >
                        {sectorLoading ? '加载中...' : '刷新'}
                    </button>
                </div>
                {sectorLoading && <div className="decision-hint">正在拉取板块趋势...</div>}
                {!sectorLoading && sectorTrends.length === 0 && (
                    <div className="decision-hint">暂无板块趋势数据（可能非交易日）</div>
                )}
                <div className="sector-trend-grid">
                    {sectorTrends.map((s) => {
                        const closes = s.klines.map((k) => k.close)
                        const dates = s.klines.map((k) => k.date.slice(5))
                        const minV = Math.min(...closes)
                        const maxV = Math.max(...closes)
                        const isUp = closes.length >= 2 && closes[closes.length - 1] >= closes[0]
                        const lineColor = isUp ? '#ef5350' : '#26a69a'
                        const option = {
                            grid: { left: 4, right: 4, top: 4, bottom: 18 },
                            xAxis: {
                                type: 'category',
                                data: dates,
                                axisLabel: { fontSize: 9 },
                                axisLine: { show: false },
                                axisTick: { show: false },
                            },
                            yAxis: {
                                type: 'value',
                                min: minV * 0.998,
                                max: maxV * 1.002,
                                show: false,
                            },
                            series: [
                                {
                                    type: 'line',
                                    data: closes,
                                    showSymbol: false,
                                    lineStyle: { color: lineColor, width: 2 },
                                    areaStyle: { color: lineColor, opacity: 0.08 },
                                },
                            ],
                            tooltip: {
                                trigger: 'axis',
                                formatter: (p: { value: number }[]) => p[0]?.value?.toFixed(2),
                            },
                        }
                        return (
                            <div key={s.code} className="sector-trend-card">
                                <div className="sector-trend-name">
                                    <span>{s.name}</span>
                                    <span className={s.changePercent >= 0 ? 'up' : 'down'}>
                                        {s.changePercent >= 0 ? '+' : ''}
                                        {s.changePercent.toFixed(2)}%
                                    </span>
                                </div>
                                <ReactECharts option={option} style={{ height: 72 }} notMerge />
                            </div>
                        )
                    })}
                </div>
            </section>
        </div>
    )
}
