import { describe, expect, it, vi } from 'vitest'

// marketRegime 会 import capitalFlow（发网络请求），这里只测纯判定逻辑
vi.mock('./capitalFlow', () => ({ fetchMarketFlowSnapshot: vi.fn() }))

import { buildIndicators, classifyRegime } from './marketRegime'
import type { KLineData } from './market'

const klines = (closes: number[], lastVolumeMult = 1): KLineData[] =>
    closes.map((c, i) => ({
        date: `d${i}`,
        open: c,
        close: c,
        high: c,
        low: c,
        volume: i === closes.length - 1 ? 1000 * lastVolumeMult : 1000,
    }))

describe('市场状态判定', () => {
    it('多头排列 + 放量 + 5 日上涨 → offensive', () => {
        const sh = buildIndicators('上证', '000001', klines(Array.from({ length: 30 }, (_, i) => 3000 + i * 10), 1.3), 0.8)
        const r = classifyRegime(sh)
        expect(r.regime).toBe('offensive')
        expect(r.score).toBe(70)
    })

    it('当日大跌 2% 以上 → cash', () => {
        const sh = buildIndicators('上证', '000001', klines(Array.from({ length: 30 }, (_, i) => 3000 + i * 10)), -2.5)
        expect(classifyRegime(sh).regime).toBe('cash')
    })

    it('跌破 MA20 且空头排列 → cash', () => {
        const sh = buildIndicators('上证', '000001', klines(Array.from({ length: 30 }, (_, i) => 3300 - i * 10)), -0.3)
        expect(sh.aboveMa20).toBe(false)
        expect(sh.ma5AboveMa20).toBe(false)
        expect(classifyRegime(sh).regime).toBe('cash')
    })

    it('多头但缩量 → defensive，分数为正', () => {
        const sh = buildIndicators('上证', '000001', klines(Array.from({ length: 30 }, (_, i) => 3000 + i * 10), 0.5), 0.2)
        const r = classifyRegime(sh)
        expect(r.regime).toBe('defensive')
        expect(r.score).toBe(5) // +15 多头排列，-10 缩量
    })

    it('数据不足时不判 cash/offensive', () => {
        const sh = buildIndicators('上证', '000001', klines([3000, 3010, 3020]), null)
        expect(classifyRegime(sh)).toEqual({ regime: 'defensive', score: 0 })
    })
})
