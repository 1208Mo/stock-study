import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHoldingsStore } from '../stores/holdingsStore'
import type { Holding } from '../types'
import StockCard from '../components/StockCard'
import AddHoldingModal from '../components/AddHoldingModal'

export default function Portfolio() {
    const { holdings, loading, fetchHoldings, deleteHolding } = useHoldingsStore()
    const [showAdd, setShowAdd] = useState(false)
    const [editingHolding, setEditingHolding] = useState<Holding | null>(null)
    const navigate = useNavigate()

    useEffect(() => {
        fetchHoldings()
        const interval = setInterval(() => {
            useHoldingsStore.getState().refreshQuotes()
        }, 30000)
        return () => clearInterval(interval)
    }, [])

    const totalProfit = holdings.reduce((sum, h) => sum + (h.profit ?? 0), 0)
    const totalCost = holdings.reduce((sum, h) => sum + h.cost_price * h.quantity, 0)
    const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">持仓管理</h1>
                <button className="btn-primary" onClick={() => setShowAdd(true)}>
                    + 添加持仓
                </button>
            </div>

            {holdings.length > 0 && (
                <div className="summary-bar">
                    <div className="summary-item">
                        <span className="summary-label">持仓数量</span>
                        <span className="summary-value">{holdings.length} 只</span>
                    </div>
                    <div className="summary-item">
                        <span className="summary-label">总盈亏</span>
                        <span className={`summary-value ${totalProfit >= 0 ? 'up' : 'down'}`}>
                            {totalProfit >= 0 ? '+' : ''}
                            {totalProfit.toFixed(2)} 元
                        </span>
                    </div>
                    <div className="summary-item">
                        <span className="summary-label">总收益率</span>
                        <span
                            className={`summary-value ${totalProfitPercent >= 0 ? 'up' : 'down'}`}
                        >
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
                <div className="stock-grid">
                    {holdings.map((h) => (
                        <StockCard
                            key={h.id}
                            holding={h}
                            quote={h.quote}
                            profit={h.profit}
                            profitPercent={h.profitPercent}
                            onClick={() =>
                                navigate(`/stock/${h.code}?name=${encodeURIComponent(h.name)}`)
                            }
                            onDelete={() => deleteHolding(h.id)}
                            onEdit={() => setEditingHolding(h)}
                        />
                    ))}
                </div>
            )}

            {showAdd && <AddHoldingModal onClose={() => setShowAdd(false)} />}
            {editingHolding && (
                <AddHoldingModal
                    editingHolding={editingHolding}
                    onClose={() => setEditingHolding(null)}
                />
            )}
        </div>
    )
}
