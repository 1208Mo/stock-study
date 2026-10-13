import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { KLineData } from './market'

const fetchKLine = vi.fn<(code: string, days: number) => Promise<KLineData[]>>()
vi.mock('./market', () => ({ fetchKLine: (code: string, days: number) => fetchKLine(code, days) }))

import { runBacktest } from './backtest'

function bars(closes: number[]): KLineData[] {
    return closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: c, close: c, high: c, low: c, volume: 1000 }))
}

describe('策略回测', () => {
    beforeEach(() => fetchKLine.mockReset())

    it('信号次日开盘成交，并计入佣金和印花税', async () => {
        // 先跌后涨再跌：MA2 上穿 MA3 买入，下穿卖出
        const closes = [10, 9, 8, 7, 8, 10, 12, 14, 13, 11, 9, 8, ...new Array(20).fill(8)]
        fetchKLine.mockResolvedValue(bars(closes))
        const r = await runBacktest({ code: '600000', name: '测试', strategy: 'ma_cross', params: { short: 2, long: 3 }, days: 60 })

        expect(r.tradeCount).toBe(1)
        const t = r.trades[0]
        expect(t.open).toBe(false)
        // 第 6 根（收 10）MA2=9 上穿 MA3≈8.33 → 第 7 根开盘 12 买入
        expect(t.entryDate).toBe('2026-01-07')
        expect(t.entryPrice).toBe(12)
        expect(t.returnPct).toBeCloseTo(((t.exitPrice! - 12) / 12) * 100)
        expect(r.totalFee).toBeGreaterThan(0)
        // 买卖各收至少 5 元佣金 + 卖出千一印花税
        expect(r.totalFee).toBeGreaterThanOrEqual(10)
        expect(r.equity).toHaveLength(closes.length)
        expect(r.benchmarkReturnPct).toBeCloseTo(-20)
    })

    it('一直没有信号时全程空仓，净值不变', async () => {
        fetchKLine.mockResolvedValue(bars(new Array(40).fill(10)))
        const r = await runBacktest({ code: '600000', name: '测试', strategy: 'breakout', days: 60 })
        expect(r.tradeCount).toBe(0)
        expect(r.totalReturnPct).toBe(0)
        expect(r.exposurePct).toBe(0)
    })

    it('参数不合法时报错', async () => {
        fetchKLine.mockResolvedValue(bars(new Array(40).fill(10)))
        await expect(
            runBacktest({ code: '600000', name: '测试', strategy: 'ma_cross', params: { short: 20, long: 5 } })
        ).rejects.toThrow('短期均线必须小于长期均线')
    })

    it('最后仍持仓时按最后收盘价估值并标记未平仓', async () => {
        fetchKLine.mockResolvedValue(bars([10, 9, 8, 7, 8, 10, 12, 14, 16, 18, ...new Array(25).fill(0).map((_, i) => 18 + i)]))
        const r = await runBacktest({ code: '600000', name: '测试', strategy: 'ma_cross', params: { short: 2, long: 3 }, days: 60 })
        expect(r.trades[0].open).toBe(true)
        expect(r.trades[0].exitReason).toBe('仍持仓')
        expect(r.totalReturnPct).toBeGreaterThan(0)
    })
})
