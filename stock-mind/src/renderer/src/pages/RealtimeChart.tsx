import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import type { QuoteData } from '../types'

interface PricePoint {
    time: string
    price: number
    change: number
}

function getTodayKey(code: string) {
    const d = new Date()
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return `realtime_${code}_${date}`
}

function loadTodayPoints(code: string): PricePoint[] {
    try {
        const raw = localStorage.getItem(getTodayKey(code))
        if (!raw) return []
        return JSON.parse(raw) as PricePoint[]
    } catch {
        return []
    }
}

function savePoints(code: string, pts: PricePoint[]) {
    try {
        // 只保留最近 2000 个点（够一整天5秒一个点）
        const trimmed = pts.length > 2000 ? pts.slice(-2000) : pts
        localStorage.setItem(getTodayKey(code), JSON.stringify(trimmed))
        // 清理7天前的旧数据
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 7)
        for (const key of Object.keys(localStorage)) {
            if (!key.startsWith('realtime_')) continue
            const parts = key.split('_')
            const dateStr = parts[parts.length - 1]
            if (dateStr < cutoff.toISOString().slice(0, 10)) {
                localStorage.removeItem(key)
            }
        }
    } catch {
        /* storage full: ignore */
    }
}

export default function RealtimeChart() {
    const { code } = useParams<{ code: string }>()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const name = searchParams.get('name') ?? code ?? ''

    const [quote, setQuote] = useState<QuoteData | null>(null)
    const [points, setPoints] = useState<PricePoint[]>(() => (code ? loadTodayPoints(code) : []))
    const [error, setError] = useState<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const basePrice = useRef<number | null>(null)
    const [basePriceVal, setBasePriceVal] = useState<number | null>(null)

    useEffect(() => {
        if (!code) return
        // 进入页面时加载已存储的今日数据
        const saved = loadTodayPoints(code)
        setPoints(saved)
        fetchQuote()
        timerRef.current = setInterval(fetchQuote, 5000)
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [code])

    async function fetchQuote() {
        if (!code) return
        try {
            const q = await window.api.market.getQuote(code)
            setQuote(q)
            setError(null)
            if (basePrice.current === null) {
                basePrice.current = q.open
                setBasePriceVal(q.open)
            }
            const now = new Date()
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
            setPoints((prev) => {
                // 去重：同一秒内不重复追加
                if (prev.length > 0 && prev[prev.length - 1].time === timeStr) return prev
                const next = [...prev, { time: timeStr, price: q.price, change: q.changePercent }]
                savePoints(code, next)
                return next
            })
        } catch (e) {
            setError(e instanceof Error ? e.message : '行情获取失败')
        }
    }

    // 图表最多展示 500 个点，避免太密
    const displayPoints =
        points.length > 500
            ? points.filter((_, i) => i % Math.ceil(points.length / 500) === 0)
            : points

    const isUp = (quote?.changePercent ?? 0) >= 0
    const lineColor = isUp ? '#ef5350' : '#26a69a'

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            formatter: (params: { dataIndex: number }[]) => {
                if (!params[0]) return ''
                const pt = displayPoints[params[0].dataIndex]
                if (!pt) return ''
                return `${pt.time}<br/>价格：${pt.price}<br/>涨跌幅：${pt.change >= 0 ? '+' : ''}${pt.change.toFixed(2)}%`
            },
        },
        grid: { left: '8%', right: '4%', top: '12%', bottom: '12%' },
        xAxis: {
            type: 'category',
            data: displayPoints.map((p) => p.time),
            axisLabel: {
                interval: Math.floor(displayPoints.length / 8),
                fontSize: 11,
                color: '#aaa',
            },
            axisLine: { lineStyle: { color: '#333' } },
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLabel: { fontSize: 11, color: '#aaa' },
            splitLine: { lineStyle: { color: '#1e2a3a' } },
        },
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { show: displayPoints.length > 60, type: 'slider', bottom: 4, height: 16 },
        ],
        series: [
            {
                type: 'line',
                data: displayPoints.map((p) => p.price),
                smooth: false,
                showSymbol: false,
                lineStyle: { width: 2, color: lineColor },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [
                            { offset: 0, color: lineColor + '44' },
                            { offset: 1, color: lineColor + '00' },
                        ],
                    },
                },
                markLine:
                    basePriceVal != null
                        ? {
                              silent: true,
                              symbol: 'none',
                              data: [{ yAxis: basePriceVal, name: '开盘价' }],
                              label: {
                                  show: true,
                                  formatter: `开盘 ${basePriceVal}`,
                                  position: 'end',
                                  fontSize: 11,
                                  color: '#888',
                              },
                              lineStyle: { type: 'dashed', color: '#888', width: 1.5 },
                          }
                        : undefined,
            },
        ],
    }

    return (
        <div className="page">
            <div className="page-header">
                <button className="btn-back" onClick={() => navigate(-1)}>
                    ← 返回
                </button>
                <h1 className="page-title">
                    {name} ({code}) 实时走势
                </h1>
                <span className="quote-live-dot" title="每5秒刷新" />
            </div>

            {quote && (
                <div className="realtime-quote-bar">
                    <span
                        className="realtime-price"
                        style={{ color: isUp ? '#ef5350' : '#26a69a' }}
                    >
                        {quote.price}
                    </span>
                    <span className={`change ${isUp ? 'up' : 'down'}`} style={{ fontSize: 18 }}>
                        {isUp ? '+' : ''}
                        {quote.changePercent.toFixed(2)}%
                    </span>
                    <div className="realtime-stats">
                        <span>开 {quote.open}</span>
                        <span>高 {quote.high}</span>
                        <span>低 {quote.low}</span>
                        <span>量 {(quote.volume / 10000).toFixed(0)}万手</span>
                        <span>额 {(quote.amount / 1e8).toFixed(2)}亿</span>
                    </div>
                </div>
            )}

            {error && (
                <div className="error-msg" style={{ margin: '12px 0' }}>
                    {error}
                </div>
            )}

            {displayPoints.length < 2 ? (
                <div className="loading" style={{ margin: '40px auto' }}>
                    等待数据（每5秒更新一次）...
                </div>
            ) : (
                <div style={{ margin: '12px 0' }}>
                    <ReactECharts option={option} style={{ height: 400 }} notMerge={false} />
                    <p style={{ textAlign: 'right', fontSize: 11, color: '#666', marginTop: 4 }}>
                        今日已记录 {points.length} 个价格点 · 虚线为今日开盘价 ·
                        数据保存在本地，关闭后不丢失
                    </p>
                </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                <button
                    className="btn-secondary"
                    onClick={() => navigate(`/stock/${code}?name=${encodeURIComponent(name)}`)}
                >
                    查看K线图 & AI分析
                </button>
                <button
                    className="btn-small"
                    style={{ color: '#888' }}
                    onClick={() => {
                        if (!code) return
                        localStorage.removeItem(getTodayKey(code))
                        setPoints([])
                    }}
                >
                    清除今日记录
                </button>
            </div>
        </div>
    )
}
