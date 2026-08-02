import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHoldingsStore } from '../stores/holdingsStore'
import type { Holding, DividendRecord } from '../types'
import AddHoldingModal from '../components/AddHoldingModal'
import { Tooltip } from '../components/Tooltip'

export default function Portfolio() {
    const { holdings, loading, fetchHoldings, deleteHolding } = useHoldingsStore()
    const [showAdd, setShowAdd] = useState(false)
    const [editingHolding, setEditingHolding] = useState<Holding | null>(null)
    const [tradingHolding, setTradingHolding] = useState<Holding | null>(null)
    const [lastRefresh, setLastRefresh] = useState(Date.now())
    const [sectorRefreshing, setSectorRefreshing] = useState(false)
    // 首次加载后自动补全缺失板块的持仓，无需用户手动点"刷新板块"
    const autoFillSectorRef = useRef(false)
    const [sectorFilter, setSectorFilter] = useState<string>('全部')
    const [dividendsMap, setDividendsMap] = useState<Record<string, DividendRecord[]>>({})
    const [divLoading, setDivLoading] = useState(false)
    const divLoadedRef = useRef(false)
    const navigate = useNavigate()

    // 批量刷新所有持仓的板块-细分板块（直接调 IPC，最后统一 reload，避免逐个刷新）
    async function handleRefreshSectors() {
        if (sectorRefreshing || holdings.length === 0) return
        setSectorRefreshing(true)
        try {
            for (let i = 0; i < holdings.length; i += 4) {
                const batch = holdings.slice(i, i + 4)
                await Promise.all(
                    batch.map(async (h) => {
                        try {
                            const info = await window.api.market.getSectorInfo(h.code)
                            if (info.sector || info.subSector) {
                                await window.api.holdings.updateSector(h.id, info.sector, info.subSector)
                            }
                        } catch {
                            // ignore single failure
                        }
                    })
                )
            }
            await fetchHoldings()
        } finally {
            setSectorRefreshing(false)
        }
    }

    // 批量拉取所有持仓的分红记录（每批4只并发，单只失败容错）
    async function loadDividends() {
        if (divLoading || holdings.length === 0) return
        setDivLoading(true)
        try {
            const map: Record<string, DividendRecord[]> = {}
            for (let i = 0; i < holdings.length; i += 4) {
                const batch = holdings.slice(i, i + 4)
                const results = await Promise.all(
                    batch.map(async (h): Promise<[string, DividendRecord[]]> => {
                        try {
                            const d = await window.api.market.getDividends(h.code)
                            return [h.code, d]
                        } catch {
                            return [h.code, []]
                        }
                    })
                )
                for (const [code, d] of results) map[code] = d
            }
            setDividendsMap(map)
        } finally {
            setDivLoading(false)
        }
    }

    useEffect(() => {
        fetchHoldings()
        const interval = setInterval(() => {
            useHoldingsStore.getState().refreshQuotes()
            setLastRefresh(Date.now())
        }, 30000)
        return () => clearInterval(interval)
    }, [])

    // 自动补全缺失板块（sector 与 sub_sector 均为空）的持仓，首次加载静默执行一次
    useEffect(() => {
        if (autoFillSectorRef.current) return
        if (loading || holdings.length === 0) return
        const missing = holdings.filter((h) => !h.sector && !h.sub_sector)
        if (missing.length === 0) return
        autoFillSectorRef.current = true
        ;(async () => {
            setSectorRefreshing(true)
            try {
                for (let i = 0; i < missing.length; i += 4) {
                    const batch = missing.slice(i, i + 4)
                    await Promise.all(
                        batch.map(async (h) => {
                            try {
                                const info = await window.api.market.getSectorInfo(h.code)
                                if (info.sector || info.subSector) {
                                    await window.api.holdings.updateSector(h.id, info.sector, info.subSector)
                                }
                            } catch {
                                // ignore single failure
                            }
                        })
                    )
                }
                await fetchHoldings()
            } finally {
                setSectorRefreshing(false)
            }
        })()
    }, [holdings, loading])

    // 首次加载完成后自动拉取一次分红记录
    useEffect(() => {
        if (divLoadedRef.current) return
        if (loading || holdings.length === 0) return
        divLoadedRef.current = true
        loadDividends()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [holdings, loading])

    const today = new Date().toISOString().slice(0, 10)
    const currentYear = today.slice(0, 4)

    const totalCost = holdings.reduce(
        (sum, h) => sum + (h.avg_cost_price ?? h.cost_price) * h.quantity,
        0
    )
    const totalMarketValue = holdings.reduce(
        (sum, h) => sum + (h.quote?.price ?? (h.avg_cost_price ?? h.cost_price)) * h.quantity,
        0
    )
    const totalProfit = holdings.reduce((sum, h) => sum + (h.profit ?? 0), 0)
    const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0

    // 按板块分组与筛选
    const UNCATEGORIZED = '未分类'
    const sectorKey = (s?: string) => (s && s.trim()) || UNCATEGORIZED
    const sectorCounts = useMemo(() => {
        const map = new Map<string, number>()
        for (const h of holdings) {
            const k = sectorKey(h.sector)
            map.set(k, (map.get(k) ?? 0) + 1)
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1])
    }, [holdings])
    const filteredHoldings =
        sectorFilter === '全部' ? holdings : holdings.filter((h) => sectorKey(h.sector) === sectorFilter)
    const sectorGroups = useMemo(() => {
        const map = new Map<string, (typeof holdings)[number][]>()
        for (const h of filteredHoldings) {
            const k = sectorKey(h.sector)
            if (!map.has(k)) map.set(k, [])
            map.get(k)!.push(h)
        }
        return [...map.entries()].map(([name, items]) => {
            const mv = items.reduce(
                (s, h) => s + (h.quote?.price ?? (h.avg_cost_price ?? h.cost_price)) * h.quantity,
                0
            )
            const profit = items.reduce((s, h) => s + (h.profit ?? 0), 0)
            return { name, items, mv, profit }
        })
    }, [filteredHoldings])

    // 每只有分红记录的持仓 → 派生股息率/最近分红/预计到账等
    const dividendRows = useMemo(() => {
        const rows: Array<{
            holding: (typeof holdings)[number]
            latest: DividendRecord
            annualDiv: number
            annualYear: string
            yieldPct: number | null
            estPayout: number
            status: '已派发' | '待派发'
            freq: string
        }> = []
        for (const h of holdings) {
            const divs = dividendsMap[h.code]
            if (!divs || divs.length === 0) continue
            const latest = divs[0] // 接口已按 REPORT_DATE 降序
            // 最近一个完整年度的累计每股分红
            const byYear = new Map<string, number>()
            for (const d of divs) byYear.set(d.year, (byYear.get(d.year) ?? 0) + d.divPerShare)
            const completeYears = [...byYear.keys()].filter((y) => y && y !== currentYear)
            const pickYear =
                completeYears.length > 0
                    ? completeYears.sort().reverse()[0]
                    : ([...byYear.keys()].filter(Boolean).sort().reverse()[0] ?? '')
            const annualDiv = byYear.get(pickYear) ?? 0
            const price = h.quote?.price
            const yieldPct = price && price > 0 ? (annualDiv / price) * 100 : null
            const estPayout = latest.divPerShare * h.quantity * 0.8
            const status: '已派发' | '待派发' =
                latest.exDivDate && latest.exDivDate < today ? '已派发' : '待派发'
            // 频率归纳：近3年每年派息次数
            const recentYears = [...byYear.keys()].filter(Boolean).sort().reverse().slice(0, 3)
            const perYearCount = new Map<string, number>()
            for (const d of divs) {
                if (recentYears.includes(d.year))
                    perYearCount.set(d.year, (perYearCount.get(d.year) ?? 0) + 1)
            }
            const counts = [...perYearCount.values()]
            let freq = '不规律'
            if (counts.length > 0 && Math.max(...counts) === Math.min(...counts)) {
                const n = counts[0]
                freq = n === 1 ? '年派1次' : `年派${n}次`
            }
            rows.push({ holding: h, latest, annualDiv, annualYear: pickYear, yieldPct, estPayout, status, freq })
        }
        rows.sort((a, b) => (b.yieldPct ?? -1) - (a.yieldPct ?? -1))
        return rows
    }, [holdings, dividendsMap, currentYear, today])

    const totalEstPayout = dividendRows.reduce((s, r) => s + r.estPayout, 0)

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp)
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    function renderRow(h: (typeof holdings)[number]) {
        const isUp = (h.quote?.changePercent ?? 0) >= 0
        const isProfitable = (h.profit ?? 0) >= 0
        const marketValue = (h.quote?.price ?? (h.avg_cost_price ?? h.cost_price)) * h.quantity
        
        const divs = dividendsMap[h.code]
        let dividendContent = <span className="text-muted">--</span>
        
        if (divs && divs.length > 0) {
            const latest = divs[0]
            const byYear = new Map<string, number>()
            for (const d of divs) byYear.set(d.year, (byYear.get(d.year) ?? 0) + d.divPerShare)
            const completeYears = [...byYear.keys()].filter((y) => y && y !== currentYear)
            const pickYear =
                completeYears.length > 0
                    ? completeYears.sort().reverse()[0]
                    : ([...byYear.keys()].filter(Boolean).sort().reverse()[0] ?? '')
            const annualDiv = byYear.get(pickYear) ?? 0
            const price = h.quote?.price
            const yieldPct = price && price > 0 ? (annualDiv / price) * 100 : null
            const estPayout = latest.divPerShare * h.quantity * 0.8
            const status: '已派发' | '待派发' =
                latest.exDivDate && latest.exDivDate < today ? '已派发' : '待派发'
                
            dividendContent = (
                <div className="dividend-cell">
                    <span className="dividend-yield">{yieldPct !== null ? `${yieldPct.toFixed(2)}%` : '--'}</span>
                    <span className="dividend-payout">≈ {estPayout.toFixed(2)} 元</span>
                    <span className={`dividend-status ${status === '待派发' ? 'pending' : 'paid'}`}>{status}</span>
                </div>
            )
        }

        return (
            <div
                key={h.id}
                className={`portfolio-row ${isUp ? 'up' : 'down'}`}
                onClick={() =>
                    navigate(`/realtime/${h.code}?name=${encodeURIComponent(h.name)}`)
                }
            >
                <div className="col-name">
                    <span className="stock-name">{h.name}</span>
                    <span className="stock-code">{h.code}</span>
                    {(h.sector || h.sub_sector) && (
                        <span className="sector-tag">
                            {[h.sector, h.sub_sector].filter(Boolean).join(' · ')}
                        </span>
                    )}
                </div>
                <div className="col-price">
                    <span className="price">{h.quote?.price ?? '--'}</span>
                    {h.quote && (
                        <span className="price-detail">
                            开{h.quote.open} 高{h.quote.high} 低{h.quote.low}
                        </span>
                    )}
                </div>
                <div className={`col-change ${isUp ? 'up' : 'down'}`}>
                    {h.quote?.changePercent !== undefined ? (
                        <>
                            <span className="change-value">
                                {isUp ? '+' : ''}
                                {h.quote.changePercent.toFixed(2)}%
                            </span>
                            <span className="change-amount">
                                ({isUp ? '+' : ''}{h.quote.change.toFixed(2)})
                            </span>
                        </>
                    ) : (
                        '--'
                    )}
                </div>
                <div className="col-cost">
                    {(h.avg_cost_price ?? h.cost_price).toFixed(2)}
                </div>
                <div className="col-qty">
                    {h.quantity} 股
                </div>
                <div className="col-market">
                    {marketValue.toFixed(2)}
                </div>
                <div className={`col-profit ${isProfitable ? 'up' : 'down'}`}>
                    {isProfitable ? '+' : ''}
                    {(h.profit ?? 0).toFixed(2)}
                </div>
                <div className={`col-profit-pct ${isProfitable ? 'up' : 'down'}`}>
                    {isProfitable ? '+' : ''}
                    {(h.profitPercent ?? 0).toFixed(2)}%
                </div>
                <div className="col-dividend">
                    {dividendContent}
                </div>
                <div className="col-actions">
                    <Tooltip content="加仓/减仓">
                        <button
                            className="btn-action"
                            onClick={(e) => {
                                e.stopPropagation()
                                setTradingHolding(h)
                            }}
                        >
                            ➕
                        </button>
                    </Tooltip>
                    <Tooltip content="编辑">
                        <button
                            className="btn-action"
                            onClick={(e) => {
                                e.stopPropagation()
                                setEditingHolding(h)
                            }}
                        >
                            ✎
                        </button>
                    </Tooltip>
                    <Tooltip content="删除">
                        <button
                            className="btn-action btn-delete"
                            onClick={(e) => {
                                e.stopPropagation()
                                deleteHolding(h.id)
                            }}
                        >
                            ×
                        </button>
                    </Tooltip>
                </div>
            </div>
        )
    }

    return (
        <div className="page portfolio-page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">持仓管理</h1>
                    <div className="portfolio-subtitle">
                        <span className="quote-live-dot" title="行情每30秒自动刷新" />
                        <span className="last-refresh">最后刷新: {formatTime(lastRefresh)}</span>
                    </div>
                </div>
                <div className="page-header-actions">
                    <button
                        className="btn-secondary"
                        onClick={handleRefreshSectors}
                        disabled={sectorRefreshing || holdings.length === 0}
                        title="重新获取所有持仓的板块-细分板块"
                    >
                        {sectorRefreshing ? '刷新中...' : '刷新板块'}
                    </button>
                    <button className="btn-primary" onClick={() => setShowAdd(true)}>
                        + 添加持仓
                    </button>
                </div>
            </div>

            {holdings.length > 0 && (
                <div className="portfolio-summary">
                    <div className="summary-item">
                        <span className="summary-label">持仓数量</span>
                        <span className="summary-value">{holdings.length} 只</span>
                    </div>
                    <div className="summary-divider" />
                    <div className="summary-item">
                        <span className="summary-label">总市值</span>
                        <span className="summary-value">{totalMarketValue.toFixed(2)} 元</span>
                    </div>
                    <div className="summary-divider" />
                    <div className="summary-item">
                        <span className="summary-label">总成本</span>
                        <span className="summary-value">{totalCost.toFixed(2)} 元</span>
                    </div>
                    <div className="summary-divider" />
                    <div className={`summary-item ${totalProfit >= 0 ? 'up' : 'down'}`}>
                        <span className="summary-label">总盈亏</span>
                        <span className={`summary-value ${totalProfit >= 0 ? 'up' : 'down'}`}>
                            {totalProfit >= 0 ? '+' : ''}
                            {totalProfit.toFixed(2)} 元
                        </span>
                    </div>
                    <div className="summary-divider" />
                    <div className={`summary-item ${totalProfitPercent >= 0 ? 'up' : 'down'}`}>
                        <span className="summary-label">总收益率</span>
                        <span className={`summary-value ${totalProfitPercent >= 0 ? 'up' : 'down'}`}>
                            {totalProfitPercent >= 0 ? '+' : ''}
                            {totalProfitPercent.toFixed(2)}%
                        </span>
                    </div>
                    {totalEstPayout > 0 && (
                        <>
                            <div className="summary-divider" />
                            <div className="summary-item up">
                                <span className="summary-label">分红合计(税后)</span>
                                <span className="summary-value">+{totalEstPayout.toFixed(2)} 元</span>
                            </div>
                        </>
                    )}
                </div>
            )}

            {holdings.length > 0 && (
                <div className="sector-chips">
                    <button
                        className={`sector-chip ${sectorFilter === '全部' ? 'active' : ''}`}
                        onClick={() => setSectorFilter('全部')}
                    >
                        全部 <span className="chip-count">{holdings.length}</span>
                    </button>
                    {sectorCounts.map(([name, count]) => (
                        <button
                            key={name}
                            className={`sector-chip ${sectorFilter === name ? 'active' : ''}`}
                            onClick={() => setSectorFilter(name)}
                        >
                            {name} <span className="chip-count">{count}</span>
                        </button>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="loading">加载中...</div>
            ) : holdings.length === 0 ? (
                <div className="empty-state">
                    <p>还没有持仓，点击右上角添加</p>
                </div>
            ) : (
                <div className="portfolio-table">
                    <div className="portfolio-table-scroll">
                        <div className="portfolio-table-header">
                            <div className="col-name">股票</div>
                            <div className="col-price">现价</div>
                            <div className="col-change">涨跌幅</div>
                            <div className="col-cost">成本价</div>
                            <div className="col-qty">持仓量</div>
                            <div className="col-market">市值</div>
                            <div className="col-profit">盈亏</div>
                            <div className="col-profit-pct">收益率</div>
                            <div className="col-dividend">分红</div>
                            <div className="col-actions">操作</div>
                        </div>
                        <div className="portfolio-table-body">
                            {sectorFilter === '全部'
                                ? filteredHoldings.map((h) => renderRow(h))
                                : sectorGroups.map((g) => (
                                      <Fragment key={g.name}>
                                          <div className="sector-group-banner">
                                              <span className="sector-group-name">{g.name}</span>
                                              <span className="sector-group-meta">
                                                  {g.items.length} 只 · 市值 {g.mv.toFixed(0)} · 盈亏{' '}
                                                  <span className={g.profit >= 0 ? 'up' : 'down'}>
                                                      {g.profit >= 0 ? '+' : ''}
                                                      {g.profit.toFixed(0)}
                                                  </span>
                                              </span>
                                          </div>
                                          {g.items.map((h) => renderRow(h))}
                                      </Fragment>
                                  ))}
                        </div>
                    </div>
                </div>
            )}

            {showAdd && <AddHoldingModal onClose={() => setShowAdd(false)} />}
            {editingHolding && (
                <AddHoldingModal
                    editingHolding={editingHolding}
                    onClose={() => setEditingHolding(null)}
                />
            )}
            {tradingHolding && (
                <AddHoldingModal
                    tradingHolding={tradingHolding}
                    onClose={() => setTradingHolding(null)}
                />
            )}
        </div>
    )
}
