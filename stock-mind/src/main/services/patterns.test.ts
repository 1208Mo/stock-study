import { describe, expect, it } from 'vitest'
import type { Bar } from '../../shared/indicators'
import { evaluatePatterns, evaluateSignals, pairSignalTrades, type SignalTradeEvent } from './patterns'

function series(closes: number[], volumes?: number[]): Bar[] {
    return closes.map((c, i) => ({
        date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        open: c * 0.995,
        close: c,
        high: c * 1.005,
        low: c * 0.99,
        volume: volumes?.[i] ?? 10_000,
    }))
}

describe('选股形态', () => {
    const uptrend = series(Array.from({ length: 80 }, (_, i) => 10 + i * 0.1))

    it('稳定上涨：均线多头、站上 20/60 日线、创 20 日新高', () => {
        const ids = evaluatePatterns(uptrend, ['ma_bull', 'above_ma20', 'above_ma60', 'breakout_20', 'rsi_oversold']).map((h) => h.id)
        expect(ids).toEqual(['ma_bull', 'above_ma20', 'above_ma60', 'breakout_20'])
    })

    it('K 线不足时不判定，避免误报', () => {
        expect(evaluatePatterns(uptrend.slice(0, 30), ['ma_bull', 'breakout_55'])).toEqual([])
    })

    it('放量突破需要量价配合', () => {
        const closes = [...new Array(25).fill(10), 11]
        const flat = series(closes)
        expect(evaluatePatterns(flat, ['volume_breakout'])).toEqual([])
        const volumes = [...new Array(25).fill(1000), 5000]
        const surge = series(closes, volumes)
        const hit = evaluatePatterns(surge, ['volume_breakout'])
        expect(hit.map((h) => h.id)).toEqual(['volume_breakout'])
        expect(hit[0].reason).toContain('5.0 倍')
    })

    it('持续下跌触发 RSI 超卖和九转买入结构', () => {
        const down = series(Array.from({ length: 30 }, (_, i) => 30 - i * 0.5))
        const ids = evaluatePatterns(down, ['rsi_oversold', 'td9_buy', 'ma_bull']).map((h) => h.id)
        expect(ids).toEqual(['rsi_oversold', 'td9_buy'])
    })
})

describe('监控信号', () => {
    // 先跌后涨：MA5 会在拐头后上穿 MA20
    const closes = [...Array.from({ length: 30 }, (_, i) => 20 - i * 0.2), ...Array.from({ length: 15 }, (_, i) => 14.2 + i * 0.6)]
    const bars = series(closes)

    it('均线金叉只在穿越那根触发', () => {
        const fired = bars.map((_, i) => evaluateSignals(bars, ['ma_golden'], i).length > 0)
        const idx = fired.indexOf(true)
        expect(idx).toBeGreaterThan(30)
        expect(fired.filter(Boolean)).toHaveLength(1)
        const hit = evaluateSignals(bars, ['ma_golden'], idx)[0]
        expect(hit.direction).toBe('buy')
        expect(hit.barTime).toBe(bars[idx].date)
        expect(hit.price).toBe(bars[idx].close)
    })

    it('第 i 根的判定不依赖 i 之后的数据（无未来函数）', () => {
        for (let i = 25; i < bars.length; i++) {
            const full = evaluateSignals(bars, ['ma_golden', 'macd_golden', 'breakout_20', 'kdj_golden'], i).map((h) => h.id)
            const cut = evaluateSignals(bars.slice(0, i + 1), ['ma_golden', 'macd_golden', 'breakout_20', 'kdj_golden']).map((h) => h.id)
            expect(full).toEqual(cut)
        }
    })

    it('突破 20 周期新高只在刚突破时报一次', () => {
        const fired = bars.map((_, i) => evaluateSignals(bars, ['breakout_20'], i).length > 0)
        expect(fired.filter(Boolean).length).toBe(1)
    })
})

describe('信号逐笔配对', () => {
    const ev = (barTime: string, direction: 'buy' | 'sell', price: number, code = '600000', period = 'day'): SignalTradeEvent => ({
        code,
        name: code,
        period,
        direction,
        barTime,
        price,
    })

    it('空仓买、持仓卖；重复买点和空仓卖点被忽略', () => {
        const trips = pairSignalTrades([
            ev('2026-01-05', 'sell', 9), // 空仓卖点，忽略
            ev('2026-01-06', 'buy', 10),
            ev('2026-01-07', 'buy', 10.5), // 持仓中重复买点，忽略
            ev('2026-01-09', 'sell', 11),
            ev('2026-01-12', 'buy', 12),
        ])
        expect(trips).toHaveLength(2)
        expect(trips[0]).toMatchObject({ entryPrice: 10, exitPrice: 11 })
        expect(trips[0].returnPct).toBeCloseTo(10)
        expect(trips[1]).toMatchObject({ entryPrice: 12, exitTime: null, returnPct: null })
    })

    it('不同股票、不同周期各自独立配对，输入乱序也按时间处理', () => {
        const trips = pairSignalTrades([
            ev('2026-01-09', 'sell', 22, '000001'),
            ev('2026-01-06', 'buy', 20, '000001'),
            ev('2026-01-06 10:30', 'buy', 5, '600000', '60m'),
            ev('2026-01-06 14:00', 'sell', 4.5, '600000', '60m'),
        ])
        expect(trips).toHaveLength(2)
        const a = trips.find((t) => t.code === '000001')!
        const b = trips.find((t) => t.code === '600000')!
        expect(a.returnPct).toBeCloseTo(10)
        expect(b.returnPct).toBeCloseTo(-10)
    })
})
