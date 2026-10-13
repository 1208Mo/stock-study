import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { HoldingTrade, KLineData } from '../types'
import { useChartTheme } from '../utils/chartTheme'
import {
    calcBBI,
    calcBoll,
    calcKDJ,
    calcMA,
    calcMACD,
    calcRSI,
    calcTD,
    calcVolumeProfile,
    detectDivergence,
    limitPrices,
    type Series,
} from '../../../shared/indicators'

export type SubIndicator = 'MACD' | 'KDJ' | 'RSI'

/** 主图叠加项 */
export interface Overlays {
    /** 布林带 */
    boll?: boolean
    /** BBI 多空线 */
    bbi?: boolean
    /** 神奇九转计数 */
    td?: boolean
    /** 涨跌停价位线（仅日K/分钟K） */
    limit?: boolean
    /** 成交量分布（随可见区间重算） */
    vpvr?: boolean
    /** 自动背离检测，指标源跟随副图 */
    divergence?: boolean
}

type DrawTool = 'none' | 'hline' | 'trend' | 'fib'

interface Drawing {
    id: string
    type: Exclude<DrawTool, 'none'>
    points: Array<{ date: string; price: number }>
}

interface Props {
    data: KLineData[]
    title?: string
    /** 副图指标，默认 MACD */
    subIndicator?: SubIndicator
    /** 兼容旧调用：是否叠加布林带（等同 overlays.boll） */
    showBoll?: boolean
    overlays?: Overlays
    /** 当前周期，用于判断涨跌停线是否适用 */
    period?: string
    /** 股票代码/名称，用于计算涨跌停幅度 */
    code?: string
    name?: string
    /** 持仓成本价：在主图画一条水平虚线 */
    costPrice?: number | null
    /** 买卖记录：在对应日期标出 B/S 点 */
    trades?: HoldingTrade[]
    /** 画线存储键（如 "600519|day"），不传则不显示画线工具 */
    drawingKey?: string
    height?: number
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const NO_OVERLAYS: Overlays = {}
const DRAW_HINT: Record<DrawTool, string> = {
    none: '',
    hline: '在图上点一下，画一条水平支撑/压力线',
    trend: '依次点击两个点，画一条趋势线（自动向右延伸）',
    fib: '依次点击波段起点和终点，画斐波那契回撤位',
}

function loadDrawings(key?: string): Drawing[] {
    if (!key) return []
    try {
        return JSON.parse(localStorage.getItem(`kline_drawings:${key}`) || '[]')
    } catch {
        return []
    }
}

function saveDrawings(key: string, drawings: Drawing[]): void {
    localStorage.setItem(`kline_drawings:${key}`, JSON.stringify(drawings))
}

/** 默认展示最近约 120 根，太少则展示后半段 */
function defaultZoom(n: number): { start: number; end: number } {
    if (n <= 120) return { start: n > 60 ? 50 : 0, end: 100 }
    return { start: Math.max(0, 100 - (120 / n) * 100), end: 100 }
}

/** 分钟K/日K 最新交易日的昨收：取最后一根所在日之前那天的最后一根收盘 */
function prevCloseOfLastDay(data: KLineData[], period?: string): number | null {
    if (data.length < 2) return null
    if (!period || period === 'day') return data[data.length - 2].close
    if (!period.endsWith('m')) return null
    const lastDay = data[data.length - 1].date.slice(0, 10)
    for (let i = data.length - 2; i >= 0; i--) {
        if (data[i].date.slice(0, 10) !== lastDay) return data[i].close
    }
    return null
}

export default function KLineChart({
    data,
    title,
    subIndicator = 'MACD',
    showBoll = false,
    overlays = NO_OVERLAYS,
    period,
    code,
    name,
    costPrice,
    trades,
    drawingKey,
    height = 580,
}: Props) {
    const theme = useChartTheme()
    const chartRef = useRef<ReactECharts>(null)
    const dataKey = `${data.length}|${data[0]?.date ?? ''}|${drawingKey ?? ''}`
    const [zoom, setZoom] = useState(() => defaultZoom(data.length))
    const zoomTimer = useRef<ReturnType<typeof setTimeout>>()
    const [tool, setTool] = useState<DrawTool>('none')
    const [pending, setPending] = useState<{ date: string; price: number } | null>(null)
    const [drawings, setDrawings] = useState<Drawing[]>(() => loadDrawings(drawingKey))

    // 换股/换周期时重置缩放和画线
    useEffect(() => {
        setZoom(defaultZoom(data.length))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataKey])
    useEffect(() => {
        setDrawings(loadDrawings(drawingKey))
        setPending(null)
    }, [drawingKey])
    const dates = useMemo(() => data.map((d) => d.date), [data])

    // 画线：在主图区域点击，把像素坐标换算成 [K线序号, 价格]
    useEffect(() => {
        const chart = chartRef.current?.getEchartsInstance()
        if (!chart || tool === 'none' || !drawingKey) return
        const zr = chart.getZr()
        const onClick = (e: { offsetX: number; offsetY: number }) => {
            const pt = [e.offsetX, e.offsetY]
            if (!chart.containPixel({ gridIndex: 0 }, pt)) return
            const [x, y] = chart.convertFromPixel({ gridIndex: 0 }, pt) as number[]
            const idx = Math.max(0, Math.min(dates.length - 1, Math.round(x)))
            const point = { date: dates[idx], price: parseFloat(y.toFixed(3)) }
            const commit = (d: Drawing) => {
                setDrawings((prev) => {
                    const next = [...prev, d]
                    saveDrawings(drawingKey, next)
                    return next
                })
                setPending(null)
                setTool('none')
            }
            const id = `${Date.now()}`
            if (tool === 'hline') return commit({ id, type: 'hline', points: [point] })
            if (!pending) return setPending(point)
            commit({ id, type: tool, points: [pending, point] })
        }
        zr.on('click', onClick)
        return () => {
            zr.off('click', onClick)
        }
    }, [tool, pending, dates, drawingKey])

    const removeDrawing = (id: string) => {
        if (!drawingKey) return
        setDrawings((prev) => {
            const next = prev.filter((d) => d.id !== id)
            saveDrawings(drawingKey, next)
            return next
        })
    }
    const clearDrawings = () => {
        if (!drawingKey) return
        saveDrawings(drawingKey, [])
        setDrawings([])
    }

    // 记录用户的缩放区间：父组件定时刷新时不把视图弹回默认位置，VPVR 也按可见区间重算
    const onEvents = useMemo(
        () => ({
            datazoom: () => {
                clearTimeout(zoomTimer.current)
                zoomTimer.current = setTimeout(() => {
                    const opt = chartRef.current?.getEchartsInstance().getOption() as
                        | { dataZoom?: Array<{ start: number; end: number }> }
                        | undefined
                    const dz = opt?.dataZoom?.[0]
                    if (dz) setZoom({ start: dz.start, end: dz.end })
                }, 150)
            },
        }),
        []
    )
    const option = useMemo(() => {
        if (data.length === 0) return null
        const ov: Overlays = { ...overlays, boll: overlays.boll ?? showBoll }
        const values = data.map((d) => [d.open, d.close, d.low, d.high])
        const volumes = data.map((d) => d.volume)
        const closes = data.map((d) => d.close)
        const upColor = theme.up
        const downColor = theme.down
        const lastIdx = data.length - 1
        const dateIndex = new Map(dates.map((d, i) => [d, i]))
        const dayIndex = new Map(dates.map((d, i) => [d.slice(0, 10), i]))
        const legend: string[] = ['K线', 'MA5', 'MA10', 'MA20', 'MA30']

        const line = (seriesName: string, d: Series, color: string, axis = 0, extra: Record<string, unknown> = {}) => ({
            name: seriesName,
            type: 'line',
            xAxisIndex: axis,
            yAxisIndex: axis,
            data: d,
            smooth: axis === 0,
            showSymbol: false,
            lineStyle: { width: 1.4, color },
            itemStyle: { color },
            ...extra,
        })

        const maColors: Record<number, string> = { 5: '#facc15', 10: '#60a5fa', 20: '#f97316', 30: '#a78bfa' }
        const mainSeries: Record<string, unknown>[] = [5, 10, 20, 30].map((p) => line(`MA${p}`, calcMA(closes, p), maColors[p]))

        if (ov.boll) {
            const { upper, mid, lower } = calcBoll(closes)
            const dashed = { lineStyle: { width: 1, color: '#22d3ee', type: 'dashed', opacity: 0.9 } }
            mainSeries.push(
                line('BOLL上轨', upper, '#22d3ee', 0, dashed),
                line('BOLL中轨', mid, '#22d3ee', 0, { lineStyle: { width: 1, color: '#22d3ee' } }),
                line('BOLL下轨', lower, '#22d3ee', 0, dashed)
            )
            legend.push('BOLL上轨', 'BOLL中轨', 'BOLL下轨')
        }
        if (ov.bbi) {
            mainSeries.push(line('BBI', calcBBI(closes), '#f472b6', 0, { lineStyle: { width: 1.8, color: '#f472b6' } }))
            legend.push('BBI')
        }

        // ── 主图 markLine / markPoint：成本线、涨跌停、画线、背离连线 ──
        // 单个值（水平线）或起止两点（线段）
        const markLines: Array<Record<string, unknown> | Record<string, unknown>[]> = []
        const markPoints: Record<string, unknown>[] = []
        const labelStyle = (color: string) => ({ color, fontSize: 10, position: 'insideEndTop' as const })

        if (costPrice && costPrice > 0) {
            markLines.push({
                yAxis: costPrice,
                label: { ...labelStyle(theme.text), formatter: `成本 ${costPrice.toFixed(2)}` },
                lineStyle: { color: '#a78bfa', type: 'dashed', width: 1.2 },
            })
        }
        if (ov.limit && code) {
            const prev = prevCloseOfLastDay(data, period)
            if (prev) {
                const { up, down } = limitPrices(prev, code, name)
                markLines.push(
                    { yAxis: up, label: { ...labelStyle(upColor), formatter: `涨停 ${up}` }, lineStyle: { color: upColor, type: 'dotted', width: 1 } },
                    { yAxis: down, label: { ...labelStyle(downColor), formatter: `跌停 ${down}` }, lineStyle: { color: downColor, type: 'dotted', width: 1 } }
                )
            }
        }

        for (const dr of drawings) {
            const color = '#fbbf24'
            if (dr.type === 'hline') {
                markLines.push({ yAxis: dr.points[0].price, label: { ...labelStyle(color), formatter: `${dr.points[0].price}` }, lineStyle: { color, width: 1.2 } })
                continue
            }
            const [a, b] = dr.points
            const ia = dateIndex.get(a.date)
            const ib = dateIndex.get(b.date)
            if (ia === undefined || ib === undefined) continue
            if (dr.type === 'trend') {
                // 按斜率向右延伸到最后一根，变成射线，方便看未来的支撑/压力
                const slope = ib !== ia ? (b.price - a.price) / (ib - ia) : 0
                const [l, r] = ia <= ib ? [{ i: ia, p: a.price }, { i: ib, p: b.price }] : [{ i: ib, p: b.price }, { i: ia, p: a.price }]
                const endPrice = parseFloat((r.p + slope * (lastIdx - r.i)).toFixed(3))
                markLines.push([
                    { coord: [dates[l.i], l.p], lineStyle: { color, width: 1.4 }, label: { show: false } },
                    { coord: [dates[lastIdx], endPrice] },
                ])
            } else {
                const from = Math.min(ia, ib)
                FIB_LEVELS.forEach((lv) => {
                    const price = parseFloat((b.price - (b.price - a.price) * lv).toFixed(3))
                    markLines.push([
                        {
                            coord: [dates[from], price],
                            lineStyle: { color: lv === 0.5 || lv === 0.618 ? '#fb923c' : '#94a3b8', width: 1, type: lv === 0 || lv === 1 ? 'solid' : 'dashed' },
                            label: { show: true, position: 'end', color: theme.axis, fontSize: 9, formatter: `${(lv * 100).toFixed(1)}% ${price}` },
                        },
                        { coord: [dates[lastIdx], price] },
                    ])
                })
            }
        }

        const tradePoints = (trades ?? [])
            .map((t) => {
                const idx = dayIndex.get(t.trade_date.slice(0, 10))
                if (idx === undefined) return null
                const isBuy = t.trade_type === 'buy'
                return {
                    name: isBuy ? '买入' : '卖出',
                    coord: [idx, isBuy ? data[idx].low : data[idx].high],
                    value: isBuy ? 'B' : 'S',
                    itemStyle: { color: isBuy ? upColor : downColor },
                    symbolRotate: isBuy ? 180 : 0,
                }
            })
            .filter(Boolean) as Record<string, unknown>[]
        markPoints.push(...tradePoints)
        // ── 副图 ──
        let subLegend: string[] = []
        let subSeries: Record<string, unknown>[] = []
        /** 背离检测用的指标线，跟随副图 */
        let divSource: Series = []
        if (subIndicator === 'MACD') {
            const { dif, dea, bar } = calcMACD(closes)
            divSource = dif
            subLegend = ['DIF', 'DEA', 'MACD']
            subSeries = [
                line('DIF', dif, '#60a5fa', 2),
                line('DEA', dea, '#f97316', 2),
                {
                    name: 'MACD',
                    type: 'bar',
                    xAxisIndex: 2,
                    yAxisIndex: 2,
                    data: bar,
                    itemStyle: {
                        color: (p: { dataIndex: number }) => ((bar[p.dataIndex] ?? 0) >= 0 ? upColor : downColor),
                    },
                },
            ]
        } else if (subIndicator === 'KDJ') {
            const { k, d, j } = calcKDJ(data)
            divSource = k
            subLegend = ['K', 'D', 'J']
            subSeries = [line('K', k, '#facc15', 2), line('D', d, '#60a5fa', 2), line('J', j, '#f472b6', 2)]
        } else {
            const rsi = calcRSI(closes)
            divSource = rsi
            subLegend = ['RSI14']
            subSeries = [
                line('RSI14', rsi, '#34d399', 2, {
                    markLine: {
                        symbol: 'none',
                        label: { fontSize: 9, color: theme.axis },
                        lineStyle: { color: theme.axisLine, type: 'dashed' },
                        data: [{ yAxis: 70 }, { yAxis: 30 }],
                    },
                }),
            ]
        }

        if (ov.divergence) {
            for (const dv of detectDivergence(data, divSource)) {
                const bottom = dv.type === 'bottom'
                const color = bottom ? upColor : downColor
                const y = (i: number) => (bottom ? data[i].low : data[i].high)
                markLines.push([
                    { coord: [dates[dv.fromIndex], y(dv.fromIndex)], lineStyle: { color, width: 1.2, type: 'dashed' }, label: { show: false } },
                    { coord: [dates[dv.index], y(dv.index)] },
                ])
                markPoints.push({
                    name: bottom ? '底背离' : '顶背离',
                    coord: [dv.index, y(dv.index)],
                    value: bottom ? '底背' : '顶背',
                    symbol: 'roundRect',
                    symbolSize: [30, 16],
                    symbolOffset: [0, bottom ? 14 : -14],
                    itemStyle: { color },
                    label: { fontSize: 9, color: '#fff' },
                })
            }
        }
        if (ov.td) {
            // 只标 6~9：前面的计数太密，看了也没意义；9 加粗高亮
            const { buy, sell } = calcTD(closes)
            const tdSeries = (seriesName: string, counts: number[], isBuy: boolean) => ({
                name: seriesName,
                type: 'scatter',
                xAxisIndex: 0,
                yAxisIndex: 0,
                symbolSize: 1,
                itemStyle: { opacity: 0 },
                silent: true,
                tooltip: { show: false },
                data: counts.map((n, i) => (n >= 6 ? { value: [i, isBuy ? data[i].low : data[i].high], n } : null)).filter(Boolean),
                label: {
                    show: true,
                    position: isBuy ? 'bottom' : 'top',
                    distance: 4,
                    formatter: (p: { data: { n: number } }) => String(p.data.n),
                    color: isBuy ? upColor : downColor,
                    fontSize: 10,
                    fontWeight: 'bold',
                },
                labelLayout: { hideOverlap: false },
            })
            mainSeries.push(tdSeries('九转买', buy, true), tdSeries('九转卖', sell, false))
        }

        if (ov.vpvr) {
            const n = data.length
            const from = Math.max(0, Math.floor((zoom.start / 100) * (n - 1)))
            const to = Math.min(n - 1, Math.ceil((zoom.end / 100) * (n - 1)))
            const vp = calcVolumeProfile(data.slice(from, to + 1), 24)
            if (vp) {
                const maxVol = Math.max(...vp.bins.map((b) => b.volume)) || 1
                mainSeries.push({
                    name: '成交分布',
                    type: 'custom',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    silent: true,
                    z: 1,
                    tooltip: { show: false },
                    clip: true,
                    encode: { x: 0, y: [1, 2] },
                    data: vp.bins.map((b) => [from, b.low, b.high, b.volume]),
                    renderItem: (
                        params: { coordSys: { x: number; y: number; width: number; height: number } },
                        api: { value: (i: number) => number; coord: (v: number[]) => number[] }
                    ) => {
                        const cs = params.coordSys
                        const top = api.coord([api.value(0), api.value(2)])[1]
                        const bottom = api.coord([api.value(0), api.value(1)])[1]
                        const vol = api.value(3)
                        const w = (vol / maxVol) * cs.width * 0.22
                        const isPoc = vp.poc >= api.value(1) && vp.poc <= api.value(2)
                        return {
                            type: 'rect',
                            shape: { x: cs.x + cs.width - w, y: top, width: w, height: Math.max(1, bottom - top - 1) },
                            style: { fill: isPoc ? 'rgba(251, 191, 36, 0.45)' : 'rgba(148, 163, 184, 0.22)' },
                        }
                    },
                })
                markLines.push(
                    { yAxis: vp.poc, label: { ...labelStyle('#fbbf24'), formatter: `POC ${vp.poc}` }, lineStyle: { color: '#fbbf24', width: 1, type: 'solid', opacity: 0.8 } },
                    { yAxis: vp.vah, label: { ...labelStyle(theme.axis), formatter: `VAH ${vp.vah}` }, lineStyle: { color: '#94a3b8', width: 1, type: 'dotted' } },
                    { yAxis: vp.val, label: { ...labelStyle(theme.axis), formatter: `VAL ${vp.val}` }, lineStyle: { color: '#94a3b8', width: 1, type: 'dotted' } }
                )
            }
        }
        legend.push('成交量', ...subLegend)

        return {
            title: title ? { text: title, left: 'center', textStyle: { fontSize: 14, color: theme.text } } : undefined,
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                formatter: (params: Array<{ seriesName: string; seriesType: string; value: unknown; data: unknown; axisValue: string }>) => {
                    const head = params[0]?.axisValue ?? ''
                    const rows = params
                        .filter((p) => p.seriesType !== 'custom' && p.seriesType !== 'scatter')
                        .filter((p) => p.value !== null && p.value !== undefined)
                        .map((p) => {
                            if (p.seriesName === 'K线') {
                                const arr = (Array.isArray(p.data) ? p.data : p.value) as number[]
                                const [o, c, l, h] = arr.length === 5 ? arr.slice(1) : arr
                                return `开 ${o}　收 ${c}　低 ${l}　高 ${h}`
                            }
                            return `${p.seriesName}: ${p.value}`
                        })
                    return [head, ...rows].join('<br/>')
                },
            },
            legend: { data: legend, bottom: 4, textStyle: { fontSize: 11, color: theme.axis } },
            grid: [
                { left: '10%', right: '4%', top: '6%', height: '38%' }, // K线
                { left: '10%', right: '4%', top: '50%', height: '12%' }, // 成交量
                { left: '10%', right: '4%', top: '66%', height: '14%' }, // 副图指标
            ],
            xAxis: [
                { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false } },
                { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false } },
                { type: 'category', data: dates, gridIndex: 2, axisLabel: { fontSize: 10, rotate: 30 } },
            ],
            yAxis: [
                { scale: true, gridIndex: 0 },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { fontSize: 9 } },
                { scale: true, gridIndex: 2, splitNumber: 2, axisLabel: { fontSize: 9 } },
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1, 2], start: zoom.start, end: zoom.end },
                { show: true, xAxisIndex: [0, 1, 2], type: 'slider', bottom: 28, height: 18, start: zoom.start, end: zoom.end },
            ],
            series: [
                {
                    name: 'K线',
                    type: 'candlestick',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: values,
                    itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
                    markLine: markLines.length ? { symbol: 'none', silent: true, data: markLines } : undefined,
                    markPoint: markPoints.length
                        ? { symbol: 'pin', symbolSize: 26, label: { fontSize: 10, color: '#fff' }, data: markPoints }
                        : undefined,
                },
                ...mainSeries,
                {
                    name: '成交量',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: volumes,
                    itemStyle: {
                        color: (p: { dataIndex: number }) => (data[p.dataIndex].close >= data[p.dataIndex].open ? upColor : downColor),
                    },
                },
                ...subSeries,
            ],
        }
    }, [data, dates, title, subIndicator, showBoll, overlays, period, code, name, costPrice, trades, drawings, zoom, theme])
    if (!option) return null

    const toolLabel: Record<Exclude<DrawTool, 'none'>, string> = { hline: '水平线', trend: '趋势线', fib: '黄金分割' }

    return (
        <div className={`kline-chart ${tool !== 'none' ? 'drawing' : ''}`}>
            {drawingKey && (
                <div className="kline-draw-bar">
                    <span className="kline-mode-label">画线：</span>
                    {(Object.keys(toolLabel) as Array<Exclude<DrawTool, 'none'>>).map((t) => (
                        <button
                            key={t}
                            className={`btn-day ${tool === t ? 'active' : ''}`}
                            onClick={() => {
                                setPending(null)
                                setTool((cur) => (cur === t ? 'none' : t))
                            }}
                        >
                            {toolLabel[t]}
                        </button>
                    ))}
                    {drawings.length > 0 && (
                        <button className="btn-day" onClick={clearDrawings} title="清除本股票本周期的全部画线">
                            清除({drawings.length})
                        </button>
                    )}
                    {tool !== 'none' && (
                        <span className="kline-draw-hint">
                            {pending ? `起点 ${pending.date.slice(5)} @ ${pending.price}，再点一下确定终点` : DRAW_HINT[tool]}
                            <button className="btn-link" onClick={() => (setTool('none'), setPending(null))}>
                                取消
                            </button>
                        </span>
                    )}
                    {tool === 'none' && drawings.length > 0 && (
                        <span className="kline-draw-chips">
                            {drawings.map((d) => (
                                <span key={d.id} className="kline-draw-chip">
                                    {toolLabel[d.type]} {d.points.map((p) => p.price).join(' → ')}
                                    <button onClick={() => removeDrawing(d.id)} title="删除这条线">
                                        ×
                                    </button>
                                </span>
                            ))}
                        </span>
                    )}
                </div>
            )}
            <ReactECharts ref={chartRef} option={option} style={{ height }} notMerge onEvents={onEvents} />
        </div>
    )
}
