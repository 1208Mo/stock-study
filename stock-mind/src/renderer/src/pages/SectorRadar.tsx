import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type {
    CapitalFlowDaily,
    MarketFlowSnapshot,
    SectorCapitalFlow,
    AmbushSector,
    KLineData,
    SectorTrendItem,
    FlowChartTarget,
} from '../types'

// 资金额度自适应格式化：亿 / 万 / 元
function formatFlow(v: number): string {
    if (!v) return '0'
    const abs = Math.abs(v)
    if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿'
    if (abs >= 1e4) return (v / 1e4).toFixed(1) + '万'
    return v.toFixed(0)
}

const INDEX_TARGETS: FlowChartTarget[] = [
    { label: '上证指数', code: '000001', market: 'sh', kind: 'index' },
    { label: '深证成指', code: '399001', market: 'sz', kind: 'index' },
    { label: '创业板指', code: '399006', market: 'sz', kind: 'index' },
]

const DAY_OPTIONS = [30, 60, 90]

export default function SectorRadar() {
    // ② 大盘资金速览
    const [snapshots, setSnapshots] = useState<MarketFlowSnapshot[]>([])
    const [snapshotLoading, setSnapshotLoading] = useState(false)

    // 板块资金流向排行
    const [sectorFlow, setSectorFlow] = useState<SectorCapitalFlow[]>([])
    const [sectorFlowLoading, setSectorFlowLoading] = useState(false)
    const [sectorFlowError, setSectorFlowError] = useState('')

    // ③ 每日资金流向主图（量价 / 资金 两种视图）
    const [viewMode, setViewMode] = useState<'price' | 'flow'>('price')
    const [flowData, setFlowData] = useState<CapitalFlowDaily[]>([])
    const [klineData, setKlineData] = useState<KLineData[]>([])
    const [flowLoading, setFlowLoading] = useState(false)
    const [flowError, setFlowError] = useState('')
    const [flowTarget, setFlowTarget] = useState<FlowChartTarget>(INDEX_TARGETS[0])
    const [flowDays, setFlowDays] = useState(30)

    // ④ 板块热度榜
    const [sectorTrends, setSectorTrends] = useState<SectorTrendItem[]>([])
    const [sectorLoading, setSectorLoading] = useState(false)

    // ⑤ 潜伏候选板块
    const [ambushSectors, setAmbushSectors] = useState<AmbushSector[]>([])
    const [ambushLoading, setAmbushLoading] = useState(false)
    const [ambushError, setAmbushError] = useState('')

    // ⑥ 成分股下钻
    const [drillSector, setDrillSector] = useState<{ code: string; name: string } | null>(null)
    const [drillStocks, setDrillStocks] = useState<
        Array<{ code: string; name: string; changePercent: number }>
    >([])
    const [drillLoading, setDrillLoading] = useState(false)

    async function loadSnapshots() {
        setSnapshotLoading(true)
        try {
            setSnapshots(await window.api.market.getMarketFlowSnapshot())
        } catch {
            // silent
        } finally {
            setSnapshotLoading(false)
        }
    }

    async function loadSectorFlow() {
        setSectorFlowLoading(true)
        setSectorFlowError('')
        try {
            setSectorFlow(await window.api.market.getSectorCapitalFlow(15))
        } catch (e) {
            setSectorFlowError(e instanceof Error ? e.message : String(e))
            setSectorFlow([])
        } finally {
            setSectorFlowLoading(false)
        }
    }

    async function loadFlow() {
        setFlowLoading(true)
        setFlowError('')
        try {
            setFlowData(
                await window.api.market.getCapitalFlowDaily(
                    flowTarget.code,
                    flowDays,
                    flowTarget.market
                )
            )
        } catch (e) {
            setFlowError(e instanceof Error ? e.message : String(e))
            setFlowData([])
        } finally {
            setFlowLoading(false)
        }
    }

    async function loadKLine() {
        setFlowLoading(true)
        setFlowError('')
        try {
            setKlineData(
                await window.api.market.getDailyKLine(
                    flowTarget.code,
                    flowDays,
                    flowTarget.market
                )
            )
        } catch (e) {
            setFlowError(e instanceof Error ? e.message : String(e))
            setKlineData([])
        } finally {
            setFlowLoading(false)
        }
    }

    async function loadSectorTrends() {
        setSectorLoading(true)
        try {
            setSectorTrends(await window.api.market.getTopSectorTrends(12, 7))
        } catch {
            // silent
        } finally {
            setSectorLoading(false)
        }
    }

    async function loadAmbushSectors() {
        setAmbushLoading(true)
        setAmbushError('')
        try {
            setAmbushSectors(await window.api.market.getAmbushSectors(8))
        } catch (e) {
            setAmbushError(e instanceof Error ? e.message : String(e))
        } finally {
            setAmbushLoading(false)
        }
    }

    async function loadDrillStocks(code: string, name: string) {
        setDrillSector({ code, name })
        setDrillLoading(true)
        try {
            setDrillStocks(await window.api.market.getSectorTopStocks(code, 8))
        } catch {
            setDrillStocks([])
        } finally {
            setDrillLoading(false)
        }
    }

    // 点击"看资金"：切主图标的并滚回顶部
    function pickStockFlow(stock: { code: string; name: string }) {
        setFlowTarget({ label: stock.name, code: stock.code, kind: 'stock' })
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    // 初始加载
    useEffect(() => {
        loadSnapshots()
        loadSectorFlow()
        loadSectorTrends()
        loadAmbushSectors()
    }, [])

    // 主图随标的 / 天数 / 视图变化重载
    useEffect(() => {
        if (viewMode === 'price') loadKLine()
        else loadFlow()
    }, [flowTarget, flowDays, viewMode])

    // 板块资金流向排行 echarts option：横向柱状图（主力净流入，红正绿负）
    const sectorFlowOption = useMemo(() => {
        const sorted = [...sectorFlow].sort((a, b) => a.mainNet - b.mainNet) // 升序，净流入最大的显示在顶部
        return {
            grid: { left: 96, right: 88, top: 16, bottom: 20 },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: (params: Array<{ dataIndex: number }>) => {
                    const item = sorted[params[0]?.dataIndex]
                    if (!item) return ''
                    return (
                        `${item.name}<br/>` +
                        `成交额: <b style="color:${item.mainNet >= 0 ? '#ef5350' : '#26a69a'}">${formatFlow(item.mainNet)}</b><br/>` +
                        `涨跌幅: ${item.changePercent.toFixed(2)}%`
                    )
                },
            },
            xAxis: {
                type: 'value',
                axisLabel: {
                    color: '#9ca3af',
                    fontSize: 10,
                    formatter: (v: number) => formatFlow(v),
                },
                axisLine: { show: false },
                splitLine: { lineStyle: { color: 'rgba(156,163,175,0.15)', type: 'dashed' } },
            },
            yAxis: {
                type: 'category',
                data: sorted.map((d) => d.name),
                axisLine: { lineStyle: { color: '#9ca3af' } },
                axisLabel: { color: '#d1d5db', fontSize: 11 },
                axisTick: { show: false },
            },
            series: [
                {
                    type: 'bar',
                    data: sorted.map((d) => ({
                        value: d.mainNet,
                        itemStyle: { color: '#5b8ff9' }, // 成交额全为正，用统一蓝色
                        label: {
                            show: true,
                            position: 'right',
                            color: '#9ca3af',
                            fontSize: 10,
                            formatter: () => formatFlow(d.mainNet),
                        },
                    })),
                    barWidth: '60%',
                },
            ],
        }
    }, [sectorFlow])

    // 资金迁移桑基图 echarts option：
    // 左侧=跌幅板块（资金流出方，绿），右侧=涨幅板块（资金流入方，红）
    // 流出/流入强度 = |涨跌幅| × 成交额（成交越大、涨跌越深，资金迁移越活跃）
    // 流线值 = 流出板块强度 × (流入板块强度 / 总流入强度)，体现资金再平衡分配
    const sankeyOption = useMemo(() => {
        if (sectorFlow.length === 0) return null
        const inflow = sectorFlow
            .filter((s) => s.changePercent > 0)
            .map((s) => ({ name: s.name, amount: s.changePercent * s.mainNet, raw: s }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 8)
        const outflow = sectorFlow
            .filter((s) => s.changePercent < 0)
            .map((s) => ({ name: s.name, amount: Math.abs(s.changePercent) * s.mainNet, raw: s }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 8)
        if (inflow.length === 0 || outflow.length === 0) return null
        const totalInflow = inflow.reduce((a, b) => a + b.amount, 0) || 1
        const nodes = [
            ...outflow.map((s) => ({
                name: `流出·${s.name}`,
                itemStyle: { color: '#26a69a' },
            })),
            ...inflow.map((s) => ({
                name: `流入·${s.name}`,
                itemStyle: { color: '#ef5350' },
            })),
        ]
        const links = []
        for (const o of outflow) {
            for (const i of inflow) {
                const value = o.amount * (i.amount / totalInflow)
                if (value > 0) {
                    links.push({
                        source: `流出·${o.name}`,
                        target: `流入·${i.name}`,
                        value: Math.round(value),
                        oRaw: o.raw,
                        iRaw: i.raw,
                    })
                }
            }
        }
        return {
            tooltip: {
                trigger: 'item',
                formatter: (params: {
                    dataType: string
                    data: { name?: string; source?: string; target?: string; value?: number; oRaw?: SectorCapitalFlow; iRaw?: SectorCapitalFlow }
                }) => {
                    if (params.dataType === 'edge') {
                        const d = params.data
                        return (
                            `${d.source} → ${d.target}<br/>` +
                            `流出板块：${d.oRaw?.name ?? ''} ${d.oRaw?.changePercent.toFixed(2)}% 成交${formatFlow(d.oRaw?.mainNet ?? 0)}<br/>` +
                            `流入板块：${d.iRaw?.name ?? ''} +${d.iRaw?.changePercent.toFixed(2)}% 成交${formatFlow(d.iRaw?.mainNet ?? 0)}`
                        )
                    }
                    return params.data.name ?? ''
                },
            },
            series: [
                {
                    type: 'sankey',
                    data: nodes,
                    links,
                    left: 16,
                    right: 130,
                    top: 16,
                    bottom: 16,
                    nodeWidth: 14,
                    nodeGap: 6,
                    layoutIterations: 64,
                    label: { color: '#d1d5db', fontSize: 11, position: 'right' },
                    lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
                    emphasis: { focus: 'adjacency' },
                },
            ],
        }
    }, [sectorFlow])

    // ③ 主图 echarts option：双轴（主力净流入柱 + 收盘价折线）
    const flowOption = useMemo(() => {
        const dates = flowData.map((d) => d.date.slice(5))
        const mainFlows = flowData.map((d) => d.mainNet)
        const closes = flowData.map((d) => d.close)
        return {
            grid: { left: 64, right: 56, top: 40, bottom: 28 },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross', crossStyle: { color: '#9ca3af' } },
                formatter: (
                    params: Array<{ axisValue: string; value: number; seriesName: string }>
                ) => {
                    if (!params || params.length === 0) return ''
                    const main = params.find((p) => p.seriesName === '主力净流入')
                    const close = params.find((p) => p.seriesName === '收盘价')
                    return (
                        `${params[0].axisValue}<br/>` +
                        `主力净流入: ${main ? formatFlow(main.value) : '—'}<br/>` +
                        `收盘价: ${close ? close.value.toFixed(2) : '—'}`
                    )
                },
            },
            legend: {
                data: ['主力净流入', '收盘价'],
                top: 4,
                textStyle: { color: '#9ca3af', fontSize: 11 },
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { lineStyle: { color: '#9ca3af' } },
                axisLabel: { color: '#9ca3af', fontSize: 10 },
                axisTick: { show: false },
            },
            yAxis: [
                {
                    type: 'value',
                    name: '主力净流入',
                    position: 'left',
                    axisLabel: {
                        color: '#9ca3af',
                        fontSize: 10,
                        formatter: (v: number) => formatFlow(v),
                    },
                    axisLine: { show: false },
                    splitLine: { lineStyle: { color: 'rgba(156,163,175,0.15)', type: 'dashed' } },
                },
                {
                    type: 'value',
                    name: '收盘价',
                    position: 'right',
                    scale: true,
                    axisLabel: { color: '#9ca3af', fontSize: 10 },
                    axisLine: { show: false },
                    splitLine: { show: false },
                },
            ],
            series: [
                {
                    name: '主力净流入',
                    type: 'bar',
                    data: mainFlows,
                    barWidth: '60%',
                    itemStyle: {
                        color: (params: { value: number }) =>
                            params.value >= 0 ? '#ef5350' : '#26a69a',
                    },
                    markLine: {
                        symbol: 'none',
                        silent: true,
                        data: [{ yAxis: 0 }],
                        lineStyle: { color: '#6b7280', width: 1, type: 'dashed' },
                    },
                },
                {
                    name: '收盘价',
                    type: 'line',
                    yAxisIndex: 1,
                    data: closes,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { color: '#fbbf24', width: 2 },
                    itemStyle: { color: '#fbbf24' },
                    z: 3,
                },
            ],
        }
    }, [flowData])

    // ③ 量价图 echarts option：成交量柱（按涨跌着色）+ 收盘价折线
    const priceOption = useMemo(() => {
        const dates = klineData.map((d) => d.date.slice(5))
        const closes = klineData.map((d) => d.close)
        return {
            grid: { left: 64, right: 56, top: 40, bottom: 28 },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross', crossStyle: { color: '#9ca3af' } },
                formatter: (
                    params: Array<{ axisValue: string; value: number; seriesName: string }>
                ) => {
                    if (!params || params.length === 0) return ''
                    const close = params.find((p) => p.seriesName === '收盘价')
                    const vol = params.find((p) => p.seriesName === '成交量')
                    return (
                        `${params[0].axisValue}<br/>` +
                        `收盘价: ${close ? close.value.toFixed(2) : '—'}<br/>` +
                        `成交量: ${vol ? formatFlow(vol.value) : '—'}`
                    )
                },
            },
            legend: {
                data: ['成交量', '收盘价'],
                top: 4,
                textStyle: { color: '#9ca3af', fontSize: 11 },
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { lineStyle: { color: '#9ca3af' } },
                axisLabel: { color: '#9ca3af', fontSize: 10 },
                axisTick: { show: false },
            },
            yAxis: [
                {
                    type: 'value',
                    name: '成交量',
                    position: 'left',
                    axisLabel: {
                        color: '#9ca3af',
                        fontSize: 10,
                        formatter: (v: number) => formatFlow(v),
                    },
                    axisLine: { show: false },
                    splitLine: { lineStyle: { color: 'rgba(156,163,175,0.15)', type: 'dashed' } },
                },
                {
                    type: 'value',
                    name: '收盘价',
                    position: 'right',
                    scale: true,
                    axisLabel: { color: '#9ca3af', fontSize: 10 },
                    axisLine: { show: false },
                    splitLine: { show: false },
                },
            ],
            series: [
                {
                    name: '成交量',
                    type: 'bar',
                    data: klineData.map((d) => ({
                        value: d.volume,
                        itemStyle: { color: d.close >= d.open ? '#ef5350' : '#26a69a' },
                    })),
                    barWidth: '60%',
                },
                {
                    name: '收盘价',
                    type: 'line',
                    yAxisIndex: 1,
                    data: closes,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { color: '#fbbf24', width: 2 },
                    itemStyle: { color: '#fbbf24' },
                    z: 3,
                },
            ],
        }
    }, [klineData])

    // ④ 板块小折线图 option（复用 DailyDecision 样式）
    function sectorLineOption(klines: KLineData[], isUp: boolean) {
        const closes = klines.map((k) => k.close)
        const dates = klines.map((k) => k.date.slice(5))
        const minV = Math.min(...closes)
        const maxV = Math.max(...closes)
        const lineColor = isUp ? '#ef5350' : '#26a69a'
        return {
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
                formatter: (p: Array<{ value: number }>) => {
                    const rel = p[0]?.value ?? 100
                    const pct = ((rel - 100) / 100) * 100
                    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
                },
            },
        }
    }

    return (
        <div className="sector-radar-page">
            <div className="page-header">
                <div>
                    <h1>板块雷达</h1>
                    <p>板块热度 · 潜伏机会 · 每日资金流向，自上而下下钻。</p>
                </div>
            </div>

            {/* ② 大盘资金速览 */}
            <div className="summary-bar">
                {snapshotLoading && snapshots.length === 0 && (
                    <div className="decision-hint">正在加载大盘资金数据...</div>
                )}
                {snapshots.map((s) => {
                    const up = s.changePercent >= 0
                    return (
                        <div
                            key={s.code}
                            className={`summary-card ${up ? 'summary-up' : 'summary-down'}`}
                        >
                            <span className="summary-icon">{up ? '🔴' : '🟢'}</span>
                            <div className="summary-content">
                                <span className="summary-label">{s.name}</span>
                                <span className="summary-value">{formatFlow(s.mainNet)}</span>
                                <span className={up ? 'up' : 'down'}>
                                    {up ? '+' : ''}
                                    {s.changePercent.toFixed(2)}% · 主力
                                    {s.mainPct >= 0 ? '+' : ''}
                                    {s.mainPct.toFixed(2)}%
                                </span>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* 板块资金流向排行 */}
            <section className="flow-chart-section">
                <div className="flow-target-bar">
                    板块资金关注度排行 · 今日成交额（红=净流入，绿=净流出，数据来自新浪财经）
                </div>
                {sectorFlowLoading && (
                    <div className="decision-hint">正在拉取板块资金流向...</div>
                )}
                {sectorFlowError && <div className="warn-msg">{sectorFlowError}</div>}
                {!sectorFlowLoading && !sectorFlowError && sectorFlow.length === 0 && (
                    <div className="decision-hint">暂无板块资金流向数据（可能非交易日）</div>
                )}
                {sectorFlow.length > 0 && (
                    <ReactECharts
                        option={sectorFlowOption}
                        style={{ height: 480 }}
                        notMerge
                        onEvents={{
                            click: (params: { name: string }) => {
                                const item = sectorFlow.find((d) => d.name === params.name)
                                if (item) setDrillSector({ code: item.code, name: item.name })
                            },
                        }}
                    />
                )}
            </section>

            {/* 资金迁移桑基图：资金从哪流到哪 */}
            <section className="flow-chart-section">
                <div className="flow-target-bar">
                    资金迁移路径 · 左侧绿色=资金流出板块（跌），右侧红色=资金流入板块（涨），
                    流线宽度=资金迁移规模（悬停流线看明细，数据来自新浪财经）
                </div>
                {sectorFlow.length > 0 && sankeyOption === null && (
                    <div className="decision-hint">
                        今日板块全部同向（全涨或全跌），无资金迁移路径可展示
                    </div>
                )}
                {sankeyOption !== null && (
                    <ReactECharts option={sankeyOption} style={{ height: 460 }} notMerge />
                )}
            </section>

            {/* ③ 每日资金流向分析图（主图） */}
            <section className="flow-chart-section">
                <div className="flow-chart-tabs">
                    <button
                        className={`flow-tab ${viewMode === 'price' ? 'active' : ''}`}
                        onClick={() => setViewMode('price')}
                    >
                        量价走势
                    </button>
                    <button
                        className={`flow-tab ${viewMode === 'flow' ? 'active' : ''}`}
                        onClick={() => setViewMode('flow')}
                    >
                        主力资金
                    </button>
                    <span style={{ width: 12 }} />
                    {INDEX_TARGETS.map((t) => (
                        <button
                            key={t.code}
                            className={`flow-tab ${
                                flowTarget.code === t.code && flowTarget.kind === 'index'
                                    ? 'active'
                                    : ''
                            }`}
                            onClick={() => setFlowTarget(t)}
                        >
                            {t.label}
                        </button>
                    ))}
                    <span style={{ flex: 1 }} />
                    {DAY_OPTIONS.map((d) => (
                        <button
                            key={d}
                            className={`flow-tab ${flowDays === d ? 'active' : ''}`}
                            onClick={() => setFlowDays(d)}
                        >
                            {d}日
                        </button>
                    ))}
                </div>
                <div className="flow-target-bar">
                    当前：{flowTarget.label} · {flowDays}日
                    {viewMode === 'flow' ? '主力资金流向' : '量价走势'}
                    {flowTarget.kind === 'stock' && '（个股）'}
                    {viewMode === 'flow' &&
                        flowTarget.kind === 'index' &&
                        '（指数资金流以ETF近似）'}
                </div>
                {flowLoading && <div className="decision-hint">正在拉取数据...</div>}
                {flowError && <div className="warn-msg">{flowError}</div>}
                {!flowLoading && !flowError && viewMode === 'flow' && flowData.length === 0 && (
                    <div className="decision-hint">
                        暂无资金流向数据（可能非交易日或接口被限流，可切回「量价走势」查看）
                    </div>
                )}
                {!flowLoading && !flowError && viewMode === 'price' && klineData.length === 0 && (
                    <div className="decision-hint">暂无K线数据（可能非交易日）</div>
                )}
                {viewMode === 'flow' && flowData.length > 0 && (
                    <ReactECharts option={flowOption} style={{ height: 360 }} notMerge />
                )}
                {viewMode === 'price' && klineData.length > 0 && (
                    <ReactECharts option={priceOption} style={{ height: 360 }} notMerge />
                )}
            </section>

            {/* ④ 板块热度榜 */}
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
                <div className="decision-hint" style={{ marginBottom: 8 }}>
                    按7日累计涨幅排序 · 成分股聚合走势 · 点击下钻找个股
                </div>
                {sectorLoading && sectorTrends.length === 0 && (
                    <div className="decision-hint">正在拉取板块趋势...</div>
                )}
                {!sectorLoading && sectorTrends.length === 0 && (
                    <div className="decision-hint">暂无板块趋势数据（可能非交易日）</div>
                )}
                <div className="sector-trend-grid">
                    {sectorTrends.map((s) => {
                        const isUp = s.return7d >= 0
                        return (
                            <div
                                key={s.code}
                                className={`sector-trend-card ${
                                    drillSector?.code === s.code ? 'active' : ''
                                }`}
                                style={{ cursor: 'pointer' }}
                                onClick={() => loadDrillStocks(s.code, s.name)}
                            >
                                <div className="sector-trend-name">
                                    <span>{s.name}</span>
                                    <span className={s.return7d >= 0 ? 'up' : 'down'}>
                                        7日 {s.return7d >= 0 ? '+' : ''}
                                        {s.return7d.toFixed(2)}%
                                    </span>
                                </div>
                                <ReactECharts
                                    option={sectorLineOption(s.klines, isUp)}
                                    style={{ height: 60 }}
                                    notMerge
                                />
                                <div className="sector-trend-foot">
                                    <span className={s.changePercent >= 0 ? 'up' : 'down'}>
                                        今日 {s.changePercent >= 0 ? '+' : ''}
                                        {s.changePercent.toFixed(2)}%
                                    </span>
                                    {s.leaderName && (
                                        <span className="sector-leader">代表 {s.leaderName}</span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </section>

            {/* ⑤ 潜伏候选板块 */}
            <section className="sector-trend-section ambush-section">
                <div className="sector-trend-header">
                    <h3>
                        🕶️ 潜伏候选板块
                        <span className="ambush-subtitle">
                            今日温和 · 5-10日趋势健康 · 量能温和放大
                        </span>
                    </h3>
                    <button
                        className="btn-small"
                        onClick={loadAmbushSectors}
                        disabled={ambushLoading}
                    >
                        {ambushLoading ? '扫描中...' : '重新扫描'}
                    </button>
                </div>
                {ambushError && <div className="warn-msg">{ambushError}</div>}
                {ambushLoading && ambushSectors.length === 0 && (
                    <div className="decision-hint">
                        正在扫描全网 100 个行业板块，识别蓄势中的潜伏机会...
                    </div>
                )}
                {!ambushLoading && ambushSectors.length === 0 && !ambushError && (
                    <div className="decision-hint">
                        当前无符合条件的潜伏候选（可能都在热点区/破位区）
                    </div>
                )}
                <div className="ambush-grid">
                    {ambushSectors.map((s) => (
                        <div
                            key={s.code}
                            className={`ambush-card ${
                                drillSector?.code === s.code ? 'active' : ''
                            }`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => loadDrillStocks(s.code, s.name)}
                        >
                            <div className="ambush-card-header">
                                <span className="ambush-name">{s.name}</span>
                                <span className="ambush-score">得分 {s.score}</span>
                            </div>
                            <div className="ambush-metrics">
                                <span>
                                    今日{' '}
                                    <b className={s.changePercent >= 0 ? 'up' : 'down'}>
                                        {s.changePercent >= 0 ? '+' : ''}
                                        {s.changePercent.toFixed(2)}%
                                    </b>
                                </span>
                                <span>
                                    5日{' '}
                                    <b className={s.return5d >= 0 ? 'up' : 'down'}>
                                        {s.return5d >= 0 ? '+' : ''}
                                        {s.return5d}%
                                    </b>
                                </span>
                                <span>
                                    10日{' '}
                                    <b className={s.return10d >= 0 ? 'up' : 'down'}>
                                        {s.return10d >= 0 ? '+' : ''}
                                        {s.return10d}%
                                    </b>
                                </span>
                                <span>量比 {s.volumeTrend}x</span>
                                <span>距20日高 {s.distanceToHigh}%</span>
                            </div>
                            {s.reasons.length > 0 && (
                                <ul className="ambush-reasons">
                                    {s.reasons.map((r, i) => (
                                        <li key={i}>{r}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* ⑥ 成分股下钻面板 */}
            {drillSector && (
                <section className="drill-panel">
                    <div className="sector-trend-header">
                        <h3>{drillSector.name} · 成分股（今日涨幅前8）</h3>
                        <button className="btn-small" onClick={() => setDrillSector(null)}>
                            收起
                        </button>
                    </div>
                    <div className="decision-hint" style={{ marginBottom: 8 }}>
                        点击「看资金」可在上方主图查看该个股每日资金流向
                    </div>
                    {drillLoading && <div className="decision-hint">正在拉取成分股...</div>}
                    {!drillLoading && drillStocks.length === 0 && (
                        <div className="decision-hint">暂无成分股数据</div>
                    )}
                    {drillStocks.length > 0 && (
                        <div className="drill-table">
                            <div className="drill-row header">
                                <span>标的</span>
                                <span>今日涨跌幅</span>
                                <span>操作</span>
                            </div>
                            {drillStocks.map((stock) => (
                                <div className="drill-row" key={stock.code}>
                                    <span>
                                        {stock.code} {stock.name}
                                    </span>
                                    <span className={stock.changePercent >= 0 ? 'up' : 'down'}>
                                        {stock.changePercent >= 0 ? '+' : ''}
                                        {stock.changePercent.toFixed(2)}%
                                    </span>
                                    <span>
                                        <button
                                            className="btn-small"
                                            onClick={() => pickStockFlow(stock)}
                                        >
                                            看资金
                                        </button>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            <div className="disclaimer-box">
                本页面只做研究辅助，不构成投资建议。资金流向数据来自东方财富，盘中数据可能延迟。
            </div>
        </div>
    )
}
