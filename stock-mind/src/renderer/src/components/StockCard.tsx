import type { QuoteData, Holding } from '../types'

interface Props {
    holding: Holding
    quote?: QuoteData
    profit?: number
    profitPercent?: number
    onClick?: () => void
    onDelete?: () => void
    onEdit?: () => void
    onViewRealtime?: () => void
    onTrade?: () => void
}

export default function StockCard({
    holding,
    quote,
    profit,
    profitPercent,
    onClick,
    onDelete,
    onEdit,
    onViewRealtime,
    onTrade,
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
                            onViewRealtime?.()
                        }}
                        title="分时图"
                    >
                        📈
                    </button>
                    <button
                        className="btn-edit"
                        onClick={(e) => {
                            e.stopPropagation()
                            onTrade?.()
                        }}
                        title="加仓/减仓"
                    >
                        ➕
                    </button>
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
                        <span className="label">持仓量</span>
                        <span className="value">{holding.quantity} 股</span>
                    </div>
                    <div className="holding-row">
                        <span className="label">成本价</span>
                        <span className="value">
                            {(holding.avg_cost_price ?? holding.cost_price).toFixed(2)} 元
                        </span>
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

                {/* 交易记录 */}
                {holding.trades && holding.trades.length > 0 && (
                    <div className="trade-history">
                        <div className="trade-history-header">
                            <span>交易记录</span>
                            <span className="trade-count">{holding.trades.length}笔</span>
                        </div>
                        <div className="trade-list">
                            {holding.trades.slice(0, 3).map((trade) => (
                                <div key={trade.id} className={`trade-item ${trade.trade_type}`}>
                                    <span className="trade-type">
                                        {trade.trade_type === 'buy' ? '买入' : '卖出'}
                                    </span>
                                    <span className="trade-price">{trade.cost_price.toFixed(2)}</span>
                                    <span className="trade-qty">{trade.quantity}股</span>
                                    <span className="trade-date">{trade.trade_date.slice(0, 16)}</span>
                                </div>
                            ))}
                            {holding.trades.length > 3 && (
                                <div className="trade-more">
                                    +{holding.trades.length - 3} 笔更多记录...
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
