import { describe, expect, it } from 'vitest'
import { applyTrade, positionPnl } from './positionMath'

describe('持仓成本', () => {
    it('分批买入按数量加权摊薄成本', () => {
        let pos = { quantity: 0, avgCost: 0 }
        pos = applyTrade(pos, 'buy', 10, 100)
        pos = applyTrade(pos, 'buy', 13, 200)
        expect(pos.quantity).toBe(300)
        expect(pos.avgCost).toBeCloseTo(12)
    })

    it('卖出只减数量，不改变平均成本', () => {
        const pos = applyTrade({ quantity: 300, avgCost: 12 }, 'sell', 15, 100)
        expect(pos).toEqual({ quantity: 200, avgCost: 12 })
    })

    it('卖出超过持仓数量报错', () => {
        expect(() => applyTrade({ quantity: 100, avgCost: 10 }, 'sell', 11, 200)).toThrow('持仓数量不足')
    })

    it('浮动盈亏', () => {
        const { pnl, pnlPct } = positionPnl({ quantity: 200, avgCost: 12 }, 13.2)
        expect(pnl).toBeCloseTo(240)
        expect(pnlPct).toBeCloseTo(10)
    })
})
