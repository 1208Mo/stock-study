import type { QuoteData, Holding } from '../types'

interface Props {
    holding: Holding
    quote?: QuoteData
    profit?: number
    profitPercent?: number
    onClick?: () => void
    onDelete?: () => void
    onEdit?: () => void
}

export default function StockCard({
    holding,
    quote,
    profit,
    profitPercent,
    onClick,
    onDelete,
    onEdit,
}: Props) {
    const isUp = (quote?.changePercent ?? 0) >= 0
    const isProfitable = (profit ?? 0) >= 0

    return (
        <div className="stock-card" onClick={onClick}>
            <div className="stock-card-header">
                <div>
                    <span className="stock-name">{holding.name}</span>
                    <span className="stock-code">{holding.code}</span>
                </div>
                <div className="stock-card-actions">
                    <button
                        className="btn-edit"
                        onClick={(e) => {
                            e.stopPropagation()
                            onEdit?.()
                        }}
                        title="编辑"
                    >
                        ✎
                    </button>
                    <button
                        className="btn-delete"
                        onClick={(e) => {
                            e.stopPropagation()
                            onDelete?.()
                        }}
                        title="删除"
                    >
                        ×
                    </button>
                </div>
            </div>

            <div className="stock-card-body">
                <div className="price-row">
                    <span className="current-price">{quote?.price ?? '--'}</span>
                    {quote && (
                        <span className={`change-badge ${isUp ? 'up' : 'down'}`}>
                            {isUp ? '+' : ''}
                            {quote.changePercent.toFixed(2)}%
                        </span>
                    )}
                </div>

                <div className="holding-info">
                    <div className="holding-row">
                        <span className="label">成本价</span>
                        <span className="value">{holding.cost_price}</span>
                    </div>
                    <div className="holding-row">
                        <span className="label">持仓量</span>
                        <span className="value">{holding.quantity} 股</span>
                    </div>
                    {profit !== undefined && (
                        <div className="holding-row">
                            <span className="label">盈亏</span>
                            <span className={`value ${isProfitable ? 'up' : 'down'}`}>
                                {isProfitable ? '+' : ''}
                                {profit.toFixed(2)} 元
                                {profitPercent !== undefined && ` (${profitPercent.toFixed(2)}%)`}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
