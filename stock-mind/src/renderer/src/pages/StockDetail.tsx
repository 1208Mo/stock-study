import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import type { KLineData, Holding, DividendRecord, StockFundamentals, KLinePeriod, AdjustType } from '../types'
import KLineChart, { type Overlays, type SubIndicator } from '../components/KLineChart'
import AlertModal from '../components/AlertModal'
import StockNewsPanel from '../components/StockNewsPanel'
import BacktestPanel from '../components/BacktestPanel'

const PERIODS: Array<{ id: KLinePeriod; label: string }> = [
    { id: '1m', label: '1分' },
    { id: '5m', label: '5分' },
    { id: '15m', label: '15分' },
    { id: '30m', label: '30分' },
    { id: '60m', label: '60分' },
    { id: 'day', label: '日K' },
    { id: 'week', label: '周K' },
    { id: 'month', label: '月K' },
]
const DAY_OPTIONS = [60, 120, 250, 500]
/** 分钟/周/月线固定取的根数：1 分钟约 1 个交易日，60 分钟约 2 个月 */
const PERIOD_BARS: Partial<Record<KLinePeriod, number>> = { '1m': 240, '5m': 240, '15m': 240, '30m': 240, '60m': 240, week: 150, month: 120 }
const ADJUST_TEXT: Record<AdjustType, string> = { none: '不复权', qfq: '前复权', hfq: '后复权' }
const OVERLAY_ITEMS: Array<{ key: keyof Overlays; label: string; title: string }> = [
    { key: 'boll', label: 'BOLL', title: '布林带：价格的波动区间，碰上轨偏热、碰下轨偏冷' },
    { key: 'bbi', label: 'BBI', title: 'BBI 多空线：3/6/12/24 日均线的平均，收盘在其上方偏多' },
    { key: 'td', label: '九转', title: '神奇九转：连续 9 根收盘高于/低于 4 根前，提示趋势可能衰竭（只标 6~9）' },
    { key: 'divergence', label: '背离', title: '自动标出价格与副图指标的顶背离/底背离，指标源跟随当前副图' },
    { key: 'vpvr', label: '筹码分布', title: '成交量分布（VPVR）：可见区间内每个价位成交了多少，黄色为成交最密集的 POC' },
    { key: 'limit', label: '涨跌停', title: '按昨收画出今日涨停价/跌停价（主板10%、创业/科创20%、北交所30%、ST 5%）' },
]

function loadOverlays(): Overlays {
    try {
        return JSON.parse(localStorage.getItem('kline_overlays') || '{}')
    } catch {
        return {}
    }
}

// 基本面卡片：估值/盈利/成长/规模/每股/质量，缺失字段显示「—」
function fmtNum(v: number | null, d = 2, suffix = ''): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    return `${v.toFixed(d)}${suffix}`
}
function fmtPct(v: number | null, withSign = true): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    const sign = withSign && v > 0 ? '+' : ''
    return `${sign}${v.toFixed(2)}%`
}

function FundamentalsCard({ f }: { f: StockFundamentals }) {
    const peText = f.pe !== null
        ? `${fmtNum(f.pe, 1)}${f.peEpsYear ? `（${f.peEpsYear}年报）` : ''}`
        : '—'
    const items: Array<{ label: string; value: string; tone?: 'up' | 'down' }> = [
        { label: '市盈率 PE', value: peText },
        { label: '市净率 PB', value: fmtNum(f.pb, 2) },
        { label: 'ROE', value: fmtPct(f.roe, false) },
        { label: '毛利率', value: fmtPct(f.grossMargin, false) },
        { label: '净利率', value: fmtPct(f.netMargin, false) },
        {
            label: '营收同比',
            value: fmtPct(f.revenueYoy),
            tone: f.revenueYoy !== null && f.revenueYoy >= 0 ? 'up' : 'down',
        },
        {
            label: '净利同比',
            value: fmtPct(f.profitYoy),
            tone: f.profitYoy !== null && f.profitYoy >= 0 ? 'up' : 'down',
        },
        { label: '营业收入', value: f.revenueYi !== null ? `${f.revenueYi.toFixed(2)} 亿` : '—' },
        { label: '归母净利', value: f.netProfitYi !== null ? `${f.netProfitYi.toFixed(2)} 亿` : '—' },
        { label: '每股收益', value: fmtNum(f.eps, 3, ' 元') },
        { label: '每股净资产', value: fmtNum(f.bps, 2, ' 元') },
        { label: '资产负债率', value: fmtPct(f.debtRatio, false) },
    ]
    return (
        <div className="kline-ai-section fundamentals-card">
            <h3>
                基本面
                {f.reportDate && (
                    <span className="fundamentals-report">
                        {f.reportType ? `${f.reportType} · ` : ''}{f.reportDate}
                    </span>
                )}
            </h3>
            <div className="fundamentals-grid">
                {items.map((it) => (
                    <div className="fundamentals-cell" key={it.label}>
                        <div className="fundamentals-label">{it.label}</div>
                        <div className={`fundamentals-value ${it.tone ?? ''}`}>{it.value}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function StockDetail() {
    const { code } = useParams<{ code: string }>()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const name = searchParams.get('name') ?? code ?? ''

    const [showAlert, setShowAlert] = useState(false)
    const [subIndicator, setSubIndicator] = useState<SubIndicator>('MACD')
    const [overlays, setOverlays] = useState<Overlays>(loadOverlays)
    const [showMyTrades, setShowMyTrades] = useState(true)

    const [klineData, setKlineData] = useState<KLineData[]>([])
    const initialPeriod = searchParams.get('period') as KLinePeriod | null
    const [klineMode, setKlineMode] = useState<KLinePeriod>(
        initialPeriod && PERIODS.some((p) => p.id === initialPeriod) ? initialPeriod : 'day'
    )
    const [klineDays, setKlineDays] = useState(120)
    const [adjust, setAdjust] = useState<AdjustType>(() => (localStorage.getItem('kline_adjust') as AdjustType) || 'qfq')
    const [klineMeta, setKlineMeta] = useState<{ source: string; adjust: AdjustType } | null>(null)
    const [watchMsg, setWatchMsg] = useState('')
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
    const [fundamentals, setFundamentals] = useState<StockFundamentals | null>(null)
    const quoteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // 定时刷新实时股价（交易时间内每5秒）
    useEffect(() => {
        if (!code) return
        function refreshQuote() {
            if (!code || document.visibilityState !== 'visible') return
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

    // 从选股结果「详情/回测」跳过来时，K线加载完滚到回测面板
    const location = useLocation()
    useEffect(() => {
        if (location.hash === '#backtest' && klineData.length > 0) {
            document.getElementById('backtest')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
    }, [location.hash, klineData.length > 0])

    useEffect(() => {
        if (!code) return
        loadData()
    }, [code, klineMode, klineDays, adjust])

    // 每次换股：拉一次基本面（与K线周期切换解耦）
    useEffect(() => {
        if (!code) return
        let cancelled = false
        setFundamentals(null)
        window.api.market
            .getFundamentals(code)
            .then((f) => {
                if (!cancelled && f.reportDate !== null) setFundamentals(f)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [code])

    async function loadData() {
        if (!code) return
        setLoadError(null)
        try {
            const limit = klineMode === 'day' ? klineDays : PERIOD_BARS[klineMode] ?? 240
            const result = await window.api.market.getKLineEx(code, klineMode, adjust, limit)
            const klines = result.bars
            setKlineMeta({ source: result.source, adjust: result.adjust })
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

    function toggleOverlay(key: keyof Overlays) {
        setOverlays((prev) => {
            const next = { ...prev, [key]: !prev[key] }
            localStorage.setItem('kline_overlays', JSON.stringify(next))
            return next
        })
    }

    function changeAdjust(a: AdjustType) {
        localStorage.setItem('kline_adjust', a)
        setAdjust(a)
    }

    async function addToSignalPool() {
        if (!code) return
        const added = await window.api.signals.addWatch([{ code, name }])
        setWatchMsg(added > 0 ? '已加入监控池，正在回填历史信号' : '已在监控池中')
        setTimeout(() => setWatchMsg(''), 3000)
    }

    const periodLabel = PERIODS.find((p) => p.id === klineMode)?.label ?? ''
    const klineTitle = `${name} ${periodLabel}${klineMeta ? ` · ${ADJUST_TEXT[klineMeta.adjust]}` : ''}`

    return (
        <div className="page">
            <div className="page-header">
                <button className="btn-back" onClick={() => navigate(-1)}>
                    ← 返回
                </button>
                <div className="stock-header-info">
                    <h1 className="page-title">
                        {name} ({code})
                    </h1>
                    {sectorInfo && (sectorInfo.sector || sectorInfo.subSector) && (
                        <div className="stock-header-tags">
                            <span className="sector-tag">
                                {[sectorInfo.sector, sectorInfo.subSector].filter(Boolean).join(' · ')}
                            </span>
                        </div>
                    )}
                </div>
                <button
                    className="btn-secondary"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => setShowAlert(true)}
                >
                    🔔 提醒
                </button>
                <button
                    className="btn-secondary"
                    style={{ whiteSpace: 'nowrap' }}
                    title="加入技术信号监控池：盘中出现金叉/突破等买卖点时提醒"
                    onClick={addToSignalPool}
                >
                    {watchMsg || '📈 盯信号'}
                </button>
                <button
                    className="btn-secondary"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() =>
                        navigate(`/chat?q=${encodeURIComponent(`帮我全面分析一下 ${name}（${code}）：技术面、基本面、资金面和主要风险`)}`)
                    }
                >
                    ✨ 问小墨鱼
                </button>
                <button
                    className="btn-secondary"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() =>
                        navigate(`/realtime/${code}?name=${encodeURIComponent(name)}`)
                    }
                >
                    实时分时 →
                </button>
                {quote && (
                    <div className="stock-price-card">
                        <div className="stock-price-main">
                            <span className="price" style={{ color: quote.changePercent >= 0 ? 'var(--up)' : 'var(--down)' }}>
                                {quote.price}
                            </span>
                            <span className={`change ${quote.changePercent >= 0 ? 'up' : 'down'}`}>
                                {quote.changePercent >= 0 ? '+' : ''}
                                {quote.changePercent.toFixed(2)}%
                            </span>
                        </div>
                        <div className="stock-price-detail">
                            <span>开 {quote.open}</span>
                            <span>高 {quote.high}</span>
                            <span>低 {quote.low}</span>
                        </div>
                        <span className="quote-live-dot" title="实时行情（每5秒刷新）" />
                    </div>
                )}
            </div>

            <div className="kline-controls">
                <span className="kline-mode-label">周期：</span>
                {PERIODS.map((p) => (
                    <button
                        key={p.id}
                        className={`btn-day ${klineMode === p.id ? 'active' : ''}`}
                        onClick={() => setKlineMode(p.id)}
                    >
                        {p.label}
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
                <span style={{ margin: '0 4px', opacity: 0.4 }}>|</span>
                {(['qfq', 'none', 'hfq'] as AdjustType[]).map((a) => (
                    <button
                        key={a}
                        className={`btn-day ${adjust === a ? 'active' : ''}`}
                        title={
                            a === 'qfq'
                                ? '前复权：以最新价为基准，把历史价格按分红送股调低，看形态、画线用这个'
                                : a === 'hfq'
                                  ? '后复权：以上市价为基准往后累加，能看出真实的长期涨幅'
                                  : '不复权：交易所真实成交价，除权日会出现跳空缺口'
                        }
                        onClick={() => changeAdjust(a)}
                    >
                        {ADJUST_TEXT[a]}
                    </button>
                ))}
                {klineMeta && klineMeta.adjust !== adjust && (
                    <span className="kline-source-warn" title="东财数据源暂不可用，已降级到新浪（仅提供不复权数据）">
                        ⚠ 备用源仅支持不复权
                    </span>
                )}
            </div>
            <div className="kline-controls">
                <span className="kline-mode-label">副图：</span>
                {(['MACD', 'KDJ', 'RSI'] as SubIndicator[]).map((ind) => (
                    <button
                        key={ind}
                        className={`btn-day ${subIndicator === ind ? 'active' : ''}`}
                        onClick={() => setSubIndicator(ind)}
                    >
                        {ind}
                    </button>
                ))}
                <span style={{ margin: '0 4px', opacity: 0.4 }}>|</span>
                <span className="kline-mode-label">叠加：</span>
                {OVERLAY_ITEMS.map((o) => (
                    <button
                        key={o.key}
                        className={`btn-day ${overlays[o.key] ? 'active' : ''}`}
                        title={o.title}
                        onClick={() => toggleOverlay(o.key)}
                    >
                        {o.label}
                    </button>
                ))}
                {holding && (
                    <button
                        className={`btn-day ${showMyTrades ? 'active' : ''}`}
                        title="在图上标出成本线和自己的买卖点"
                        onClick={() => setShowMyTrades((v) => !v)}
                    >
                        我的成本/买卖点
                    </button>
                )}
            </div>

            <KLineChart
                data={klineData}
                title={klineTitle}
                subIndicator={subIndicator}
                overlays={overlays}
                period={klineMode}
                code={code}
                name={name}
                drawingKey={code ? `${code}|${klineMode}` : undefined}
                costPrice={showMyTrades && holding ? holding.avg_cost_price ?? holding.cost_price : null}
                trades={showMyTrades && klineMode === 'day' ? holding?.trades : undefined}
            />

            {loadError && (
                <div className="error-msg" style={{ margin: '12px 0' }}>
                    K线/行情加载失败：{loadError}
                    <button className="btn-small" style={{ marginLeft: 12 }} onClick={loadData}>
                        重试
                    </button>
                </div>
            )}

            {code && (
                <div id="backtest">
                    <BacktestPanel code={code} name={name} />
                </div>
            )}

            {code && <StockNewsPanel code={code} name={name} />}

            {fundamentals && <FundamentalsCard f={fundamentals} />}

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
            {showAlert && code && (
                <AlertModal code={code} name={name} price={quote?.price} onClose={() => setShowAlert(false)} />
            )}
        </div>
    )
}
