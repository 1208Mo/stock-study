/**
 * 持仓成本计算（纯函数，单测覆盖）
 *
 * - 买入：按数量加权摊薄平均成本
 * - 卖出：数量减少，平均成本不变（卖出盈亏单独核算，不回摊到剩余持仓）
 */

export interface PositionState {
    quantity: number
    avgCost: number
}

export function applyTrade(
    pos: PositionState,
    tradeType: 'buy' | 'sell',
    price: number,
    quantity: number
): PositionState {
    if (tradeType === 'buy') {
        const newQuantity = pos.quantity + quantity
        if (newQuantity <= 0) return { quantity: 0, avgCost: pos.avgCost }
        return { quantity: newQuantity, avgCost: (pos.avgCost * pos.quantity + price * quantity) / newQuantity }
    }
    if (pos.quantity < quantity) throw new Error('持仓数量不足')
    return { quantity: pos.quantity - quantity, avgCost: pos.avgCost }
}

/** 浮动盈亏与收益率 */
export function positionPnl(pos: PositionState, price: number): { pnl: number; pnlPct: number } {
    const pnl = (price - pos.avgCost) * pos.quantity
    return { pnl, pnlPct: pos.avgCost > 0 ? ((price - pos.avgCost) / pos.avgCost) * 100 : 0 }
}
