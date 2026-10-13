import { describe, expect, it } from 'vitest'
import {
    calcBBI,
    calcBoll,
    calcEMA,
    calcKDJ,
    calcMA,
    calcMACD,
    calcRSI,
    calcTD,
    calcVolumeProfile,
    crossDown,
    crossUp,
    detectDivergence,
    findPivots,
    limitPercent,
    limitPrices,
    type Bar,
} from './indicators'

const bar = (close: number, i: number, extra: Partial<Bar> = {}): Bar => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    open: close,
    close,
    high: close,
    low: close,
    volume: 1000,
    ...extra,
})

describe('均线类', () => {
    it('MA 前 period-1 根为 null，之后为滑动平均', () => {
        expect(calcMA([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
    })

    it('EMA 首值为第一根收盘，之后按 2/(n+1) 平滑', () => {
        const ema = calcEMA([10, 20], 3) // k = 0.5
        expect(ema).toEqual([10, 15])
    })

    it('BBI 需要 24 根才有值，常数序列 BBI 等于该常数', () => {
        const bbi = calcBBI(new Array(30).fill(8))
        expect(bbi[22]).toBeNull()
        expect(bbi[23]).toBe(8)
    })

    it('布林带：常数序列上下轨与中轨重合', () => {
        const { mid, upper, lower } = calcBoll(new Array(25).fill(5))
        expect(mid[24]).toBe(5)
        expect(upper[24]).toBe(5)
        expect(lower[24]).toBe(5)
    })
})
describe('震荡类', () => {
    it('MACD 前 25 根为空；持续上涨时 DIF 为正', () => {
        const closes = Array.from({ length: 60 }, (_, i) => 10 + i * 0.2)
        const { dif, dea, bar: hist } = calcMACD(closes)
        expect(dif[24]).toBeNull()
        expect(dea[25]).not.toBeNull()
        expect(dif[59]!).toBeGreaterThan(0)
        expect(hist[59]).toBeCloseTo((dif[59]! - dea[59]!) * 2, 2)
    })

    it('RSI：只涨不跌接近 100，只跌不涨接近 0', () => {
        const up = calcRSI(Array.from({ length: 20 }, (_, i) => 10 + i))
        const down = calcRSI(Array.from({ length: 20 }, (_, i) => 30 - i))
        expect(up[13]).toBeNull()
        expect(up[19]!).toBeGreaterThan(99)
        expect(down[19]!).toBeLessThan(1)
    })

    it('KDJ：收在区间最高点时 K、D 向 100 靠拢', () => {
        const data = Array.from({ length: 30 }, (_, i) => bar(10 + i, i, { high: 10 + i, low: 9 + i }))
        const { k, d, j } = calcKDJ(data)
        expect(k[7]).toBeNull()
        expect(k[29]!).toBeGreaterThan(90)
        expect(k[29]!).toBeGreaterThan(d[29]!)
        expect(j[29]).toBeCloseTo(3 * k[29]! - 2 * d[29]!, 1)
    })
})

describe('交叉判定', () => {
    it('crossUp / crossDown 只在穿越那一根为真', () => {
        const a = [1, 2, 3, 2, 1]
        const b = [2, 2, 2, 2, 2]
        expect(crossUp(a, b, 2)).toBe(true)
        expect(crossUp(a, b, 1)).toBe(false) // 2 = 2 还没穿过去
        expect(crossDown(a, b, 4)).toBe(true)
        expect(crossDown(a, b, 3)).toBe(false)
    })

    it('有 null 时不判定', () => {
        expect(crossUp([null, 3], [2, 2], 1)).toBe(false)
    })
})

describe('神奇九转', () => {
    it('连续 9 根收盘低于 4 根前计到 9，第 10 根重新从 1 开始', () => {
        // 前 4 根做基准，之后一路下跌
        const closes = Array.from({ length: 14 }, (_, i) => 100 - i)
        const { buy, sell } = calcTD(closes)
        expect(buy.slice(4, 13)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
        expect(buy[13]).toBe(1)
        expect(sell.every((n) => n === 0)).toBe(true)
    })

    it('中途断开则清零', () => {
        const closes = [10, 10, 10, 10, 9, 8, 12, 7]
        expect(calcTD(closes).buy).toEqual([0, 0, 0, 0, 1, 2, 0, 1])
    })
})
describe('拐点与背离', () => {
    it('findPivots 找到局部最低点', () => {
        expect(findPivots([5, 4, 3, 2, 3, 4, 5, 4, 3], 'low', 3, 2)).toEqual([3])
    })

    it('价格创新低而指标抬高 → 底背离', () => {
        // 两个 V 形低点：第二个更低；指标第二个低点更高
        const lows = [10, 9, 8, 7, 8, 9, 10, 9, 8, 7, 6, 7, 8, 9]
        const data = lows.map((l, i) => bar(l + 0.5, i, { low: l, high: l + 1 }))
        const ind = [0, -1, -2, -3, -2, -1, 0, -0.5, -1, -1.5, -2, -1, 0, 1]
        const div = detectDivergence(data, ind)
        expect(div).toEqual([{ index: 10, fromIndex: 3, type: 'bottom' }])
    })

    it('价格与指标同步创新低时不算背离', () => {
        const lows = [10, 9, 8, 7, 8, 9, 10, 9, 8, 7, 6, 7, 8, 9]
        const data = lows.map((l, i) => bar(l + 0.5, i, { low: l, high: l + 1 }))
        const ind = lows.map((l) => l - 10)
        expect(detectDivergence(data, ind)).toEqual([])
    })
})

describe('成交量分布', () => {
    it('POC 落在成交最密集的价位，价值区包含 POC', () => {
        const data = [
            bar(10, 0, { low: 10, high: 10, volume: 100 }),
            bar(12, 1, { low: 12, high: 12, volume: 1000 }),
            bar(14, 2, { low: 14, high: 14, volume: 100 }),
        ]
        const vp = calcVolumeProfile(data, 4)!
        expect(vp.poc).toBeGreaterThanOrEqual(11.5)
        expect(vp.poc).toBeLessThanOrEqual(12.5)
        expect(vp.val).toBeLessThanOrEqual(vp.poc)
        expect(vp.vah).toBeGreaterThanOrEqual(vp.poc)
        const total = vp.bins.reduce((a, b) => a + b.volume, 0)
        expect(total).toBeCloseTo(1200)
    })

    it('价格无波动时返回 null', () => {
        expect(calcVolumeProfile([bar(10, 0), bar(10, 1)])).toBeNull()
    })
})

describe('涨跌停', () => {
    it('按板块区分涨跌幅', () => {
        expect(limitPercent('600519')).toBe(10)
        expect(limitPercent('000001')).toBe(10)
        expect(limitPercent('300750')).toBe(20)
        expect(limitPercent('688981')).toBe(20)
        expect(limitPercent('830799')).toBe(30)
        expect(limitPercent('920001')).toBe(30)
        expect(limitPercent('600000', '*ST 某某')).toBe(5)
    })

    it('涨跌停价四舍五入到分', () => {
        expect(limitPrices(10.01, '600000')).toEqual({ up: 11.01, down: 9.01 })
        expect(limitPrices(25.55, '300001')).toEqual({ up: 30.66, down: 20.44 })
    })
})
