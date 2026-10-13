import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { useChartTheme } from '../utils/chartTheme'
import { Tooltip } from './Tooltip'
import { stockRoute } from '../utils/routes'
import type { PortfolioAnalytics } from '../types'

const RANGES = [
    { label: '1月', days: 22 },
    { label: '3月', days: 66 },
    { label: '6月', days: 130 },
    { label: '1年', days: 250 },
]

const PIE_COLORS = ['#4f8ef7', '#8b5cf6', '#f59e0b', '#22c55e', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#64748b']

function signed(n: number, digits = 2) {
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
}
function trend(n: number | null | undefined) {
    return !n ? '' : n > 0 ? 'up' : 'down'
}

interface Props {
    /** 持仓数量/成本的签名，变化时重新计算 */
    version: string
}

export default function PortfolioAnalysis({ version }: Props) {
    const navigate = useNavigate()
    const theme = useChartTheme()
    const [data, setData] = useState<PortfolioAnalytics | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [range, setRange] = useState(250)

    useEffect(() => {
        let cancelled = false
        setError(null)
        window.api.portfolio
            .analytics(250)
            .then((d) => !cancelled && setData(d))
            .catch((e) => !cancelled && setError(String(e)))
        return () => {
            cancelled = true
        }
    }, [version])

    // 在 1 年数据上截取区间，并把区间起点归零，方便对比
    const series = useMemo(() => {
        if (!data) return []
        const slice = data.history.slice(-range)
        if (slice.length === 0) return []
        const base = slice[0]
        const baseNav = 1 + base.returnPct / 100
        const baseBench = 1 + base.benchmarkPct / 100
        return slice.map((p) => ({
            date: p.date,
            mine: ((1 + p.returnPct / 100) / baseNav - 1) * 100,
            bench: ((1 + p.benchmarkPct / 100) / baseBench - 1) * 100,
            pnl: p.pnl,
            mv: p.marketValue,
        }))
    }, [data, range])

    const lineOption = useMemo(() => {
        if (series.length === 0) return null
        return {
            grid: { left: 48, right: 16, top: 32, bottom: 28 },
            legend: { data: ['我的组合', data?.benchmarkName ?? '基准'], textStyle: { color: theme.axis }, top: 0 },
            tooltip: {
                trigger: 'axis',
                valueFormatter: (v: number) => `${signed(v)}%`,
            },
            xAxis: {
                type: 'category',
                data: series.map((s) => s.date.slice(5)),
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
                    name: '我的组合',
                    type: 'line',
                    showSymbol: false,
                    smooth: true,
                    data: series.map((s) => +s.mine.toFixed(2)),
                    lineStyle: { width: 2, color: '#4f8ef7' },
                    itemStyle: { color: '#4f8ef7' },
                    areaStyle: { color: 'rgba(79, 142, 247, 0.12)' },
                },
                {
                    name: data?.benchmarkName ?? '基准',
                    type: 'line',
                    showSymbol: false,
                    smooth: true,
                    data: series.map((s) => +s.bench.toFixed(2)),
                    lineStyle: { width: 1.5, type: 'dashed', color: theme.axis },
                    itemStyle: { color: theme.axis },
                },
            ],
        }
    }, [series, theme, data?.benchmarkName])

    const pieOption = (items: Array<{ name: string; value: number }>) => ({
        tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 元（{d}%）' },
        color: PIE_COLORS,
        series: [
            {
                type: 'pie',
                radius: ['48%', '72%'],
                avoidLabelOverlap: true,
                itemStyle: { borderColor: 'transparent', borderWidth: 2 },
                label: { color: theme.text, formatter: '{b}\n{d}%', fontSize: 11 },
                labelLine: { lineStyle: { color: theme.axisLine } },
                data: items.map((i) => ({ ...i, value: +i.value.toFixed(2) })),
            },
        ],
    })

    const contributionOption = useMemo(() => {
        if (!data) return null
        const rows = [...data.positions]
            .map((p) => ({ name: p.name, value: p.unrealizedPnl + p.realizedPnl }))
            .sort((a, b) => a.value - b.value)
        if (rows.length === 0) return null
        return {
            grid: { left: 80, right: 40, top: 8, bottom: 8 },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${signed(v)} 元` },
            xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: theme.split } } },
            yAxis: { type: 'category', data: rows.map((r) => r.name), axisLabel: { color: theme.text } },
            series: [
                {
                    type: 'bar',
                    barMaxWidth: 16,
                    data: rows.map((r) => ({
                        value: +r.value.toFixed(2),
                        itemStyle: { color: r.value >= 0 ? theme.up : theme.down, borderRadius: 3 },
                    })),
                    label: { show: true, position: 'right', color: theme.axis, formatter: (p: { value: number }) => signed(p.value, 0) },
                },
            ],
        }
    }, [data, theme])

    if (error) return <div className="dash-card dash-muted">收益分析加载失败：{error}</div>
    if (!data) {
        return (
            <div className="pa-wrap">
                <div className="dash-skeleton" style={{ height: 90 }} />
                <div className="dash-skeleton" style={{ height: 300 }} />
            </div>
        )
    }
    if (data.positions.length === 0) {
        return <div className="dash-card dash-empty">添加持仓后，这里会显示收益曲线、仓位分布和风险提示</div>
    }

    const t = data.totals
    const excess = t.returnPct !== null && t.benchmarkPct !== null ? t.returnPct - t.benchmarkPct : null
    const rangeExcess = series.length ? series[series.length - 1].mine - series[series.length - 1].bench : null

    return (
        <div className="pa-wrap">
            <div className="pa-stats">
                <div className="pa-stat">
                    <span className="dash-asset-label">累计盈亏</span>
                    <span className={`pa-stat-value ${trend(t.totalPnl)}`}>{signed(t.totalPnl)}</span>
                    <span className="dash-muted">
                        浮动 {signed(t.unrealizedPnl, 0)} · 已实现 {signed(t.realizedPnl, 0)}
                    </span>
                </div>
                <Tooltip content="收益率 = 累计盈亏 ÷ 历史最高投入本金。从你的第一笔交易记录开始计算">
                    <div className="pa-stat">
                        <span className="dash-asset-label">组合收益率</span>
                        <span className={`pa-stat-value ${trend(t.returnPct)}`}>
                            {t.returnPct === null ? '—' : `${signed(t.returnPct)}%`}
                        </span>
                        <span className="dash-muted">
                            同期{data.benchmarkName} {t.benchmarkPct === null ? '—' : `${signed(t.benchmarkPct)}%`}
                        </span>
                    </div>
                </Tooltip>
                <Tooltip content="超额收益 = 你的收益率 − 沪深300 收益率。为正说明跑赢了大盘">
                    <div className="pa-stat">
                        <span className="dash-asset-label">超额收益</span>
                        <span className={`pa-stat-value ${trend(excess)}`}>
                            {excess === null ? '—' : `${signed(excess)}%`}
                        </span>
                        <span className="dash-muted">{excess === null ? '' : excess >= 0 ? '跑赢大盘' : '跑输大盘'}</span>
                    </div>
                </Tooltip>
                <Tooltip content="最大回撤：从最高点到之后最低点的最大跌幅，衡量你最难受的时候亏了多少">
                    <div className="pa-stat">
                        <span className="dash-asset-label">最大回撤</span>
                        <span className="pa-stat-value down">
                            {t.maxDrawdownPct === null ? '—' : `${t.maxDrawdownPct.toFixed(2)}%`}
                        </span>
                        <span className="dash-muted">
                            {t.sellCount > 0 ? `卖出胜率 ${((t.winningSells / t.sellCount) * 100).toFixed(0)}%（${t.winningSells}/${t.sellCount}）` : '暂无卖出记录'}
                        </span>
                    </div>
                </Tooltip>
            </div>

            {data.warnings.length > 0 && (
                <div className="pa-warnings">
                    {data.warnings.map((w, i) => (
                        <div key={i} className={`pa-warning ${w.level}`}>
                            <span>{w.level === 'high' ? '⚠️' : '💡'}</span>
                            {w.text}
                        </div>
                    ))}
                </div>
            )}

            <div className="dash-card">
                <div className="dash-card-header">
                    <h3>收益曲线 vs {data.benchmarkName}</h3>
                    {rangeExcess !== null && (
                        <span className={`dash-card-meta ${trend(rangeExcess)}`}>区间超额 {signed(rangeExcess)}%</span>
                    )}
                    <div className="pa-ranges">
                        {RANGES.map((r) => (
                            <button
                                key={r.days}
                                className={`btn-day ${range === r.days ? 'active' : ''}`}
                                onClick={() => setRange(r.days)}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
                {lineOption && series.length > 1 ? (
                    <ReactECharts option={lineOption} style={{ height: 300 }} notMerge />
                ) : (
                    <div className="dash-empty">
                        历史从你的第一笔交易记录开始，积累两个交易日以上就能看到曲线
                    </div>
                )}
            </div>

            <div className="pa-grid">
                <div className="dash-card">
                    <div className="dash-card-header">
                        <h3>行业分布</h3>
                    </div>
                    <ReactECharts
                        option={pieOption(data.sectors.map((s) => ({ name: s.name, value: s.marketValue })))}
                        style={{ height: 240 }}
                        notMerge
                    />
                </div>
                <div className="dash-card">
                    <div className="dash-card-header">
                        <h3>个股仓位</h3>
                    </div>
                    <ReactECharts
                        option={pieOption(
                            data.positions.filter((p) => p.marketValue > 0).map((p) => ({ name: p.name, value: p.marketValue }))
                        )}
                        style={{ height: 240 }}
                        notMerge
                        onEvents={{
                            click: (e: { name: string }) => {
                                const p = data.positions.find((x) => x.name === e.name)
                                if (p) navigate(stockRoute(p.code, p.name))
                            },
                        }}
                    />
                </div>
            </div>

            {contributionOption && (
                <div className="dash-card">
                    <div className="dash-card-header">
                        <h3>盈亏贡献</h3>
                        <span className="dash-card-meta">每只股票的浮动 + 已实现盈亏，看清是谁在赚钱、谁在拖后腿</span>
                    </div>
                    <ReactECharts
                        option={contributionOption}
                        style={{ height: Math.max(120, data.positions.length * 30 + 20) }}
                        notMerge
                    />
                </div>
            )}
        </div>
    )
}
