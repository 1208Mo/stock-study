import ReactECharts from 'echarts-for-react'
import type { KLineData } from '../types'

interface Props {
    data: KLineData[]
    title?: string
}

function calcMA(closes: number[], period: number): (number | null)[] {
    return closes.map((_, i) => {
        if (i < period - 1) return null
        const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
        return parseFloat((sum / period).toFixed(3))
    })
}

// EMA with optional seed (if seed null, uses first price)
function calcEMA(closes: number[], period: number): number[] {
    const k = 2 / (period + 1)
    const result: number[] = []
    for (let i = 0; i < closes.length; i++) {
        if (i === 0) {
            result.push(closes[0])
        } else {
            result.push(parseFloat((closes[i] * k + result[i - 1] * (1 - k)).toFixed(3)))
        }
    }
    return result
}

function calcMACD(closes: number[]): {
    dif: (number | null)[]
    dea: (number | null)[]
    bar: (number | null)[]
} {
    const ema12 = calcEMA(closes, 12)
    const ema26 = calcEMA(closes, 26)
    // DIF is meaningful only after index 25
    const difRaw = closes.map((_, i) => parseFloat((ema12[i] - ema26[i]).toFixed(3)))
    const dif: (number | null)[] = difRaw.map((v, i) => (i < 25 ? null : v))

    // DEA: 9-period EMA of DIF, start from first non-null DIF
    const deaRaw: number[] = []
    const k = 2 / (9 + 1)
    let started = false
    for (let i = 0; i < difRaw.length; i++) {
        if (i < 25) {
            deaRaw.push(0)
            continue
        }
        if (!started) {
            deaRaw.push(difRaw[i])
            started = true
        } else {
            deaRaw.push(parseFloat((difRaw[i] * k + deaRaw[i - 1] * (1 - k)).toFixed(3)))
        }
    }
    const dea: (number | null)[] = deaRaw.map((v, i) => (i < 25 ? null : v))
    const bar: (number | null)[] = difRaw.map((_, i) => {
        if (i < 25) return null
        return parseFloat(((difRaw[i] - deaRaw[i]) * 2).toFixed(3))
    })

    return { dif, dea, bar }
}

export default function KLineChart({ data, title }: Props) {
    if (data.length === 0) {
        return null
    }

    const dates = data.map((d) => d.date)
    const values = data.map((d) => [d.open, d.close, d.low, d.high])
    const volumes = data.map((d) => d.volume)
    const closes = data.map((d) => d.close)
    const upColor = '#ef5350'
    const downColor = '#26a69a'

    const maColors: Record<number, string> = {
        5: '#facc15',
        10: '#60a5fa',
        20: '#f97316',
        30: '#a78bfa',
    }
    const maSeries = [5, 10, 20, 30].map((period) => ({
        name: `MA${period}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: calcMA(closes, period),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: maColors[period] },
    }))

    const { dif, dea, bar } = calcMACD(closes)

    const option = {
        title: title ? { text: title, left: 'center', textStyle: { fontSize: 14 } } : undefined,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: (params: { seriesName: string; value: unknown }[]) => {
                return params
                    .filter((p) => p.value !== null && p.value !== undefined)
                    .map((p) => {
                        if (Array.isArray(p.value)) {
                            const [o, c, l, h] = p.value as number[]
                            return `K线  开:${o} 收:${c} 低:${l} 高:${h}`
                        }
                        return `${p.seriesName}: ${p.value}`
                    })
                    .join('<br/>')
            },
        },
        legend: {
            data: ['K线', 'MA5', 'MA10', 'MA20', 'MA30', '成交量', 'DIF', 'DEA', 'MACD'],
            bottom: 4,
            textStyle: { fontSize: 11 },
        },
        grid: [
            { left: '10%', right: '4%', top: '6%', height: '38%' }, // K线
            { left: '10%', right: '4%', top: '50%', height: '12%' }, // 成交量
            { left: '10%', right: '4%', top: '66%', height: '14%' }, // MACD
        ],
        xAxis: [
            { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false } },
            { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false } },
            {
                type: 'category',
                data: dates,
                gridIndex: 2,
                axisLabel: { fontSize: 10, rotate: 30 },
            },
        ],
        yAxis: [
            { scale: true, gridIndex: 0 },
            { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { fontSize: 9 } },
            { scale: true, gridIndex: 2, splitNumber: 2, axisLabel: { fontSize: 9 } },
        ],
        dataZoom: [
            { type: 'inside', xAxisIndex: [0, 1, 2], start: 50, end: 100 },
            { show: true, xAxisIndex: [0, 1, 2], type: 'slider', bottom: 28, height: 18 },
        ],
        series: [
            {
                name: 'K线',
                type: 'candlestick',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: values,
                itemStyle: {
                    color: upColor,
                    color0: downColor,
                    borderColor: upColor,
                    borderColor0: downColor,
                },
            },
            ...maSeries,
            {
                name: '成交量',
                type: 'bar',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: volumes,
                itemStyle: {
                    color: (params: { dataIndex: number }) => {
                        const item = data[params.dataIndex]
                        return item.close >= item.open ? upColor : downColor
                    },
                },
            },
            {
                name: 'DIF',
                type: 'line',
                xAxisIndex: 2,
                yAxisIndex: 2,
                data: dif,
                showSymbol: false,
                lineStyle: { width: 1.5, color: '#60a5fa' },
            },
            {
                name: 'DEA',
                type: 'line',
                xAxisIndex: 2,
                yAxisIndex: 2,
                data: dea,
                showSymbol: false,
                lineStyle: { width: 1.5, color: '#f97316' },
            },
            {
                name: 'MACD',
                type: 'bar',
                xAxisIndex: 2,
                yAxisIndex: 2,
                data: bar,
                itemStyle: {
                    color: (params: { dataIndex: number }) => {
                        const v = bar[params.dataIndex]
                        return v != null && v >= 0 ? upColor : downColor
                    },
                },
            },
        ],
    }

    return (
        <div className="kline-chart">
            <ReactECharts option={option} style={{ height: 580 }} notMerge />
        </div>
    )
}
