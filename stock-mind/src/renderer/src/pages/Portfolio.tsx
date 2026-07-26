import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHoldingsStore } from '../stores/holdingsStore'
import type { Holding } from '../types'
import AddHoldingModal from '../components/AddHoldingModal'
import { Tooltip } from '../components/Tooltip'

export default function Portfolio() {
    const { holdings, loading, fetchHoldings, deleteHolding } = useHoldingsStore()
    const [showAdd, setShowAdd] = useState(false)
    const [editingHolding, setEditingHolding] = useState<Holding | null>(null)
    const [tradingHolding, setTradingHolding] = useState<Holding | null>(null)
    const [lastRefresh, setLastRefresh] = useState(Date.now())
    const navigate = useNavigate()

    useEffect(() => {
        fetchHoldings()
        const interval = setInterval(() => {
            useHoldingsStore.getState().refreshQuotes()
            setLastRefresh(Date.now())
        }, 30000)
        return () => clearInterval(interval)
    }, [])

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

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp)
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
                <button className="btn-primary" onClick={() => setShowAdd(true)}>
                    + 添加持仓
                </button>
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
                            <div className="col-actions">操作</div>
                        </div>
                        <div className="portfolio-table-body">
                            {holdings.map((h) => {
                            const isUp = (h.quote?.changePercent ?? 0) >= 0
                            const isProfitable = (h.profit ?? 0) >= 0
                            const marketValue = (h.quote?.price ?? (h.avg_cost_price ?? h.cost_price)) * h.quantity
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
                                    <div className="col-actions">
                                        <Tooltip content="实时走势">
                                            <button
                                                className="btn-action"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    navigate(
                                                        `/realtime/${h.code}?name=${encodeURIComponent(h.name)}`
                                                    )
                                                }}
                                            >
                                                📈
                                            </button>
                                        </Tooltip>
                                        <Tooltip content="K线图 & AI分析">
                                            <button
                                                className="btn-action"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    navigate(
                                                        `/stock/${h.code}?name=${encodeURIComponent(h.name)}`
                                                    )
                                                }}
                                            >
                                                📊
                                            </button>
                                        </Tooltip>
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
                        })}
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
