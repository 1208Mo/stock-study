import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import type { KLineData, Holding, DividendRecord } from '../types'
import KLineChart from '../components/KLineChart'
import BuyAdvicePanel from '../components/BuyAdvicePanel'

type KLineMode = 'day' | 'week' | '5min' | '60min'

const DAY_OPTIONS = [30, 60, 90, 180]
const INTRADAY_BARS: Record<string, number> = { '5min': 78, '60min': 360 }
const INTRADAY_SCALES: Record<string, number> = { '5min': 5, '60min': 60 }

export default function StockDetail() {
    const { code } = useParams<{ code: string }>()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const name = searchParams.get('name') ?? code ?? ''

    const [klineData, setKlineData] = useState<KLineData[]>([])
    const [klineMode, setKlineMode] = useState<KLineMode>('day')
    const [klineDays, setKlineDays] = useState(60)
    const [quote, setQuote] = useState<{
        price: number
        changePercent: number
        open: number
        high: number
        low: number
    } | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [holding, setHolding] = useState<Holding | null>(null)
    const [sectorInfo, setSectorInfo] = useState<{ sector: string; subSector: string } | null>(null)
    const [dividends, setDividends] = useState<DividendRecord[]>([])
    const quoteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // 定时刷新实时股价（交易时间内每5秒）
    useEffect(() => {
        if (!code) return
        function refreshQuote() {
            if (!code) return
            window.api.market
                .getQuote(code)
                .then((q) =>
                    setQuote({
                        price: q.price,
                        changePercent: q.changePercent,
                        open: q.open,
                        high: q.high,
                        low: q.low,
                    })
                )
                .catch(() => {})
        }
        quoteTimerRef.current = setInterval(refreshQuote, 5000)
        return () => {
            if (quoteTimerRef.current) clearInterval(quoteTimerRef.current)
        }
    }, [code])

    const [klineReading, setKlineReading] = useState<string | null>(null)
    const [klineReadLoading, setKlineReadLoading] = useState(false)
    const [klineReadError, setKlineReadError] = useState<string | null>(null)

    const [tradingTResult, setTradingTResult] = useState<string | null>(null)
    const [tradingTLoading, setTradingTLoading] = useState(false)
    const [tradingTError, setTradingTError] = useState<string | null>(null)

    useEffect(() => {
        if (!code) return
        loadData()
    }, [code, klineMode, klineDays])

    async function loadData() {
        if (!code) return
        setLoadError(null)
        try {
            let klines: KLineData[]
            if (klineMode === 'day') {
                klines = await window.api.market.getKLine(code, klineDays)
            } else if (klineMode === 'week') {
                klines = await window.api.market.getWeeklyKLine(code, 60)
            } else {
                // 5min / 60min — use intraday with appropriate scale
                const bars = klineMode === '5min' ? 78 : 360
                klines = await window.api.market.getIntraday(code, bars)
            }
            const [q, holdings] = await Promise.all([
                window.api.market.getQuote(code),
                window.api.holdings.getAll(),
            ])
            setKlineData(klines)
            setQuote({
                price: q.price,
                changePercent: q.changePercent,
                open: q.open,
                high: q.high,
                low: q.low,
            })
            setHolding(holdings.find((h) => h.code === code) ?? null)
            // 板块信息只在初次加载时获取一次
            if (!sectorInfo) {
                window.api.market
                    .getSectorInfo(code)
                    .then((info) => {
                        if (info.sector || info.subSector) setSectorInfo(info)
                    })
                    .catch(() => {})
                window.api.market
                    .getDividends(code)
                    .then((d) => setDividends(d))
                    .catch(() => {})
            }
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : '行情数据加载失败，请检查网络后重试')
        }
    }

    async function handleReadKLine() {
        if (!code || !quote || klineData.length === 0) return
        setKlineReadLoading(true)
        setKlineReadError(null)
        try {
            const result = await window.api.ai.readKLine({
                code,
                name,
                currentPrice: quote.price,
                changePercent: quote.changePercent,
                klines: klineData,
            })
            setKlineReading(result.content)
        } catch (e) {
            setKlineReadError(e instanceof Error ? e.message : String(e))
        } finally {
            setKlineReadLoading(false)
        }
    }

    async function handleTradingT() {
        if (!code || !quote) return
        setTradingTLoading(true)
        setTradingTError(null)
        setTradingTResult(null)
        try {
            const intraday = await window.api.market.getIntraday(code, 48)
            const result = await window.api.ai.tradingT({
                code,
                name,
                costPrice: holding?.cost_price ?? 0,
                holdQuantity: holding?.quantity ?? 0,
                currentPrice: quote.price,
                changePercent: quote.changePercent,
                todayOpen: quote.open,
                todayHigh: quote.high,
                todayLow: quote.low,
                intraday,
            })
            setTradingTResult(result.content)
        } catch (e) {
            setTradingTError(e instanceof Error ? e.message : String(e))
        } finally {
            setTradingTLoading(false)
        }
    }

    function handleModeClick(mode: KLineMode) {
        setKlineMode(mode)
        if (mode === 'day' && klineDays === 60) {
            // same, will re-trigger via useEffect
        }
    }

    const klineTitle =
        klineMode === 'week'
            ? `${name} 周K线图`
            : klineMode === '5min'
              ? `${name} 5分钟K线图`
              : klineMode === '60min'
                ? `${name} 60分钟K线图`
                : `${name} K线图`

    return (
        <div className="page">
            <div className="page-header">
                <button className="btn-back" onClick={() => navigate(-1)}>
                    ← 返回
                </button>
                <h1 className="page-title">
                    {name} ({code})
                </h1>
                {sectorInfo && (sectorInfo.sector || sectorInfo.subSector) && (
                    <span className="sector-tag">
                        {[sectorInfo.sector, sectorInfo.subSector].filter(Boolean).join(' · ')}
                    </span>
                )}
                {quote && (
                    <div className="quote-summary">
                        <span className="price">{quote.price}</span>
                        <span className={`change ${quote.changePercent >= 0 ? 'up' : 'down'}`}>
                            {quote.changePercent >= 0 ? '+' : ''}
                            {quote.changePercent.toFixed(2)}%
                        </span>
                        <span className="quote-live-dot" title="实时行情（每5秒刷新）" />
                    </div>
                )}
            </div>

            <div className="kline-controls">
                <span className="kline-mode-label">周期：</span>
                {(['5min', '60min', 'day', 'week'] as KLineMode[]).map((m) => (
                    <button
                        key={m}
                        className={`btn-day ${klineMode === m ? 'active' : ''}`}
                        onClick={() => handleModeClick(m)}
                    >
                        {m === 'day'
                            ? '日K'
                            : m === 'week'
                              ? '周K'
                              : m === '5min'
                                ? '5分钟'
                                : '60分钟'}
                    </button>
                ))}
                {klineMode === 'day' && (
                    <>
                        <span style={{ margin: '0 4px', opacity: 0.4 }}>|</span>
                        {DAY_OPTIONS.map((d) => (
                            <button
                                key={d}
                                className={`btn-day ${klineDays === d ? 'active' : ''}`}
                                onClick={() => setKlineDays(d)}
                            >
                                {d}日
                            </button>
                        ))}
                    </>
                )}
            </div>

            <KLineChart data={klineData} title={klineTitle} />

            {loadError && (
                <div className="error-msg" style={{ margin: '12px 0' }}>
                    K线/行情加载失败：{loadError}
                    <button className="btn-small" style={{ marginLeft: 12 }} onClick={loadData}>
                        重试
                    </button>
                </div>
            )}

            {klineData.length > 0 && (
                <div className="kline-ai-section">
                    <div className="kline-ai-header">
                        <h3>📈 AI 帮你看K线</h3>
                        <button
                            className="btn-secondary"
                            onClick={handleReadKLine}
                            disabled={klineReadLoading || !quote}
                        >
                            {klineReadLoading ? '解读中...' : '用大白话解读'}
                        </button>
                    </div>
                    {klineReadError && <div className="error-msg">{klineReadError}</div>}
                    {klineReading && (
                        <div className="kline-reading markdown-body">
                            <button
                                className="btn-copy"
                                onClick={() =>
                                    navigator.clipboard.writeText(klineReading).catch(() => {})
                                }
                            >
                                复制
                            </button>
                            <ReactMarkdown>{klineReading}</ReactMarkdown>
                        </div>
                    )}
                    {!klineReading && !klineReadLoading && !klineReadError && (
                        <div className="kline-reading-hint">
                            点击上方按钮，AI
                            用大白话告诉你：这张K线图在说什么、现在处于什么位置、新手怎么看。
                        </div>
                    )}
                </div>
            )}

            <div className="kline-ai-section">
                <div className="kline-ai-header">
                    <h3>⚡ AI 帮你做T</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {holding && (
                            <span className="holding-tag">
                                持仓 {holding.quantity} 股 @ {holding.cost_price}
                            </span>
                        )}
                        <button
                            className="btn-secondary"
                            onClick={handleTradingT}
                            disabled={tradingTLoading || !quote}
                        >
                            {tradingTLoading ? '分析中...' : '获取做T步骤'}
                        </button>
                    </div>
                </div>
                {tradingTError && <div className="error-msg">{tradingTError}</div>}
                {tradingTResult && (
                    <div className="kline-reading markdown-body">
                        <button
                            className="btn-copy"
                            onClick={() =>
                                navigator.clipboard.writeText(tradingTResult).catch(() => {})
                            }
                        >
                            复制
                        </button>
                        <ReactMarkdown>{tradingTResult}</ReactMarkdown>
                    </div>
                )}
                {!tradingTResult && !tradingTLoading && !tradingTError && (
                    <div className="kline-reading-hint">
                        基于5分钟K线 + MACD，AI 给出今日做T的具体价格和步骤。
                        {holding
                            ? `当前持仓 ${holding.quantity} 股，自动按持仓做T分析。`
                            : '未持仓，按空仓波段做T分析。'}
                    </div>
                )}
            </div>

            {quote && <BuyAdvicePanel price={quote.price} changePercent={quote.changePercent} />}

            {dividends.length > 0 && (
                <div className="kline-ai-section">
                    <h3>分红记录与股息</h3>
                    <div className="dividend-table">
                        <div className="dividend-row header">
                            <span>年度</span>
                            <span>公告日期</span>
                            <span>每股分红（税前）</span>
                            <span>除权除息日</span>
                            <span>股权登记日</span>
                            {holding && <span>预计到账（{holding.quantity}股）</span>}
                        </div>
                        {dividends.map((d, i) => (
                            <div className="dividend-row" key={i}>
                                <span>{d.year}</span>
                                <span>{d.reportDate}</span>
                                <span className="up">{d.divPerShare.toFixed(4)} 元</span>
                                <span>{d.exDivDate || '—'}</span>
                                <span>{d.recordDate || '—'}</span>
                                {holding && (
                                    <span className="up">
                                        ≈ {(d.divPerShare * holding.quantity * 0.8).toFixed(2)} 元
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                    {holding && dividends[0] && (
                        <div className="dividend-summary">
                            最近一次分红（{dividends[0].year}）：每股 {dividends[0].divPerShare}{' '}
                            元， 持仓 {holding.quantity} 股，税后预计到账约{' '}
                            <strong className="up">
                                {(dividends[0].divPerShare * holding.quantity * 0.8).toFixed(2)} 元
                            </strong>
                            （扣20%红利税）。
                            {dividends[0].exDivDate && `除权除息日：${dividends[0].exDivDate}。`}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
