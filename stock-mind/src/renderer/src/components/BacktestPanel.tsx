import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useChartTheme } from '../utils/chartTheme'
import { Tooltip } from './Tooltip'
import type { BacktestResult, StrategyId, StrategyMeta } from '../types'

interface Props {
    code: string
    name: string
}

const RANGES = [
    { label: '半年', days: 130 },
    { label: '1年', days: 250 },
    { label: '2年', days: 500 },
]

function signed(v: number | null, digits = 2) {
    if (v === null) return '—'
    return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}
function trend(v: number | null) {
    return v === null || v === 0 ? '' : v > 0 ? 'up' : 'down'
}

export default function BacktestPanel({ code, name }: Props) {
    const theme = useChartTheme()
    const [strategies, setStrategies] = useState<StrategyMeta[]>([])
    const [strategy, setStrategy] = useState<StrategyId>('ma_cross')
    const [params, setParams] = useState<Record<string, number>>({})
    const [days, setDays] = useState(250)
    const [result, setResult] = useState<BacktestResult | null>(null)
    const [running, setRunning] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        window.api.backtest
            .strategies()
            .then((list) => {
                setStrategies(list)
                const first = list.find((s) => s.id === strategy) ?? list[0]
                if (first) {
                    setStrategy(first.id)
                    setParams(Object.fromEntries(first.params.map((p) => [p.key, p.default])))
                }
            })
            .catch((e) => setError(String(e)))
        // 只在挂载时拉一次策略列表
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        setResult(null)
        setError(null)
    }, [code])

    const meta = strategies.find((s) => s.id === strategy)

    const switchStrategy = (id: StrategyId) => {
        setStrategy(id)
        const m = strategies.find((s) => s.id === id)
        if (m) setParams(Object.fromEntries(m.params.map((p) => [p.key, p.default])))
        setResult(null)
        setError(null)
    }

    const run = async () => {
        setRunning(true)
        setError(null)
        try {
            setResult(await window.api.backtest.run({ code, name, strategy, params, days }))
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setRunning(false)
        }
    }

    const equityOption = useMemo(() => {
        if (!result || result.equity.length < 2) return null
        const toPct = (v: number) => +((v - 1) * 100).toFixed(2)
        return {
            grid: { left: 48, right: 16, top: 30, bottom: 24 },
            legend: { data: ['策略', '买入持有'], textStyle: { color: theme.axis }, top: 0 },
            tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v > 0 ? '+' : ''}${v}%` },
            xAxis: {
                type: 'category',
                data: result.equity.map((p) => p.date.slice(5)),
                axisLabel: { color: theme.axis },
                axisLine: { lineStyle: { color: theme.axisLine } },
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: theme.axis, formatter: '{value}%' },
                splitLine: { lineStyle: { color: theme.split } },
            },
            series: [
                {
                    name: '策略',
                    type: 'line',
                    showSymbol: false,
                    smooth: true,
                    data: result.equity.map((p) => toPct(p.strategy)),
                    lineStyle: { width: 2, color: '#4f8ef7' },
                    itemStyle: { color: '#4f8ef7' },
                    areaStyle: { color: 'rgba(79, 142, 247, 0.1)' },
                },
                {
                    name: '买入持有',
                    type: 'line',
                    showSymbol: false,
                    smooth: true,
                    data: result.equity.map((p) => toPct(p.benchmark)),
                    lineStyle: { width: 1.5, type: 'dashed', color: theme.axis },
                    itemStyle: { color: theme.axis },
                },
            ],
        }
    }, [result, theme])

    const excess = result ? result.totalReturnPct - result.benchmarkReturnPct : null

    return (
        <div className="kline-ai-section backtest-panel">
            <div className="dash-card-header">
                <h3>策略回测</h3>
                <span className="dash-card-meta">
                    用历史数据检验买卖规则：信号次日开盘成交，已计入佣金和印花税
                </span>
            </div>

            <div className="bt-strategies">
                {strategies.map((s) => (
                    <button
                        key={s.id}
                        className={`bt-strategy ${strategy === s.id ? 'active' : ''}`}
                        onClick={() => switchStrategy(s.id)}
                    >
                        {s.name}
                    </button>
                ))}
            </div>

            {meta && <p className="bt-desc">{meta.description}</p>}

            <div className="bt-controls">
                {meta?.params.map((p) => (
                    <label key={p.key} className="bt-param">
                        <span>{p.label}</span>
                        <input
                            className="input"
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={params[p.key] ?? p.default}
                            onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
                        />
                    </label>
                ))}
                <div className="bt-param">
                    <span>回测区间</span>
                    <div className="pa-ranges">
                        {RANGES.map((r) => (
                            <button
                                key={r.days}
                                className={`btn-day ${days === r.days ? 'active' : ''}`}
                                onClick={() => setDays(r.days)}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
                <button className="btn-primary" onClick={run} disabled={running || !meta}>
                    {running ? '回测中…' : '开始回测'}
                </button>
            </div>

            {error && <div className="alert-error">回测失败：{error}</div>}

            {result && (
                <>
                    <div className="bt-verdict">{result.verdict}</div>

                    <div className="bt-stats">
                        <div className="bt-stat">
                            <span className="dash-asset-label">策略收益</span>
                            <span className={`pa-stat-value ${trend(result.totalReturnPct)}`}>
                                {signed(result.totalReturnPct)}
                            </span>
                        </div>
                        <Tooltip content="同期一直持有这只股票不动的收益，策略跑不赢它就说明折腾没意义">
                            <div className="bt-stat">
                                <span className="dash-asset-label">买入持有</span>
                                <span className={`pa-stat-value ${trend(result.benchmarkReturnPct)}`}>
                                    {signed(result.benchmarkReturnPct)}
                                </span>
                            </div>
                        </Tooltip>
                        <div className="bt-stat">
                            <span className="dash-asset-label">超额</span>
                            <span className={`pa-stat-value ${trend(excess)}`}>{signed(excess)}</span>
                        </div>
                        <Tooltip content="赚钱的交易笔数占比。胜率低不一定差，关键看赚的时候赚多少">
                            <div className="bt-stat">
                                <span className="dash-asset-label">胜率</span>
                                <span className="pa-stat-value">
                                    {result.winRate === null ? '—' : `${result.winRate.toFixed(0)}%`}
                                </span>
                            </div>
                        </Tooltip>
                        <div className="bt-stat">
                            <span className="dash-asset-label">最大回撤</span>
                            <span className="pa-stat-value down">{result.maxDrawdownPct.toFixed(1)}%</span>
                        </div>
                        <Tooltip content="有多少时间真的拿着股票。占比低说明大部分时间空仓，资金效率不高">
                            <div className="bt-stat">
                                <span className="dash-asset-label">持仓占比</span>
                                <span className="pa-stat-value">{result.exposurePct.toFixed(0)}%</span>
                            </div>
                        </Tooltip>
                    </div>

                    <div className="bt-meta dash-muted">
                        {result.startDate} ~ {result.endDate} · {result.barCount} 根日K · 本金{' '}
                        {(result.capital / 10000).toFixed(1)} 万（按股价自动调整，保证买得起 1 手） · 交易{' '}
                        {result.tradeCount} 笔 · 成本 {result.totalFee.toFixed(0)} 元
                        {result.annualizedPct !== null && ` · 年化 ${signed(result.annualizedPct)}`}
                        {result.avgHoldDays !== null && ` · 平均持有 ${result.avgHoldDays.toFixed(0)} 个交易日`}
                    </div>

                    {equityOption && <ReactECharts option={equityOption} style={{ height: 260 }} notMerge />}

                    {result.trades.length > 0 && (
                        <details className="bt-trades">
                            <summary>交易明细（{result.trades.length} 笔，按时间倒序）</summary>
                            <div className="bt-trade-table">
                                <div className="bt-trade-row header">
                                    <span>买入</span>
                                    <span>买入价</span>
                                    <span>卖出</span>
                                    <span>卖出价</span>
                                    <span>离场原因</span>
                                    <span>持有</span>
                                    <span>收益</span>
                                </div>
                                {result.trades.map((t, i) => (
                                    <div className="bt-trade-row" key={i}>
                                        <span>{t.entryDate.slice(5)}</span>
                                        <span>{t.entryPrice.toFixed(2)}</span>
                                        <span>{t.exitDate ? t.exitDate.slice(5) : '—'}</span>
                                        <span>{t.exitPrice?.toFixed(2) ?? '—'}</span>
                                        <span>{t.exitReason}</span>
                                        <span>{t.holdDays} 日</span>
                                        <span className={trend(t.returnPct)}>{signed(t.returnPct, 1)}</span>
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                </>
            )}
        </div>
    )
}
