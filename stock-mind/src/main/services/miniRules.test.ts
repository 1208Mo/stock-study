import { describe, it, expect } from 'vitest'
import { Cooldown, checkCostLine, isCloseReminderTime, pushSample, surgePercent, type PriceSample } from './miniRules'

const MIN = 60_000

describe('pushSample', () => {
    it('丢弃超出保留窗口的旧采样', () => {
        const h: PriceSample[] = []
        pushSample(h, { t: 0, price: 10 }, 5 * MIN)
        pushSample(h, { t: 3 * MIN, price: 10.1 }, 5 * MIN)
        pushSample(h, { t: 7 * MIN, price: 10.2 }, 5 * MIN)
        expect(h.map((s) => s.t)).toEqual([3 * MIN, 7 * MIN])
    })
})

describe('surgePercent', () => {
    it('按窗口内最早采样计算涨速', () => {
        const h: PriceSample[] = [
            { t: 0, price: 9 }, // 窗口外
            { t: 5 * MIN, price: 10 },
            { t: 8 * MIN, price: 10.3 },
            { t: 10 * MIN, price: 10.25 },
        ]
        expect(surgePercent(h, 10 * MIN, 5 * MIN)).toBeCloseTo(2.5)
    })

    it('下跌时为负数', () => {
        const h: PriceSample[] = [
            { t: 0, price: 10 },
            { t: 4 * MIN, price: 9.7 },
        ]
        expect(surgePercent(h, 4 * MIN, 5 * MIN)).toBeCloseTo(-3)
    })

    it('采样跨度不足时不判定', () => {
        const h: PriceSample[] = [
            { t: 0, price: 10 },
            { t: 20_000, price: 11 },
        ]
        expect(surgePercent(h, 20_000, 5 * MIN)).toBeNull()
    })

    it('采样不足两个时返回 null', () => {
        expect(surgePercent([], 0, 5 * MIN)).toBeNull()
        expect(surgePercent([{ t: 0, price: 10 }], 0, 5 * MIN)).toBeNull()
    })
})

describe('checkCostLine', () => {
    it('达到止盈线', () => {
        expect(checkCostLine(11, 10, 10, 5)).toBe('take_profit')
    })
    it('达到止损线', () => {
        expect(checkCostLine(9.5, 10, 10, 5)).toBe('stop_loss')
    })
    it('区间内不触发', () => {
        expect(checkCostLine(10.4, 10, 10, 5)).toBeNull()
    })
    it('阈值为 0 时关闭对应规则', () => {
        expect(checkCostLine(20, 10, 0, 5)).toBeNull()
        expect(checkCostLine(5, 10, 10, 0)).toBeNull()
    })
    it('成本或价格无效时不触发', () => {
        expect(checkCostLine(10, 0, 10, 5)).toBeNull()
        expect(checkCostLine(0, 10, 10, 5)).toBeNull()
    })
})

describe('isCloseReminderTime', () => {
    const at = (hh: number, mm: number) => new Date(2026, 9, 15, hh, mm)
    it('14:50-14:59 为尾盘提醒时段', () => {
        expect(isCloseReminderTime(at(14, 50))).toBe(true)
        expect(isCloseReminderTime(at(14, 59))).toBe(true)
    })
    it('其他时间不提醒', () => {
        expect(isCloseReminderTime(at(14, 49))).toBe(false)
        expect(isCloseReminderTime(at(15, 0))).toBe(false)
        expect(isCloseReminderTime(at(10, 0))).toBe(false)
    })
})

describe('Cooldown', () => {
    it('冷却期内同一 key 只放行一次', () => {
        const c = new Cooldown(10 * MIN)
        expect(c.allow('a', 0)).toBe(true)
        expect(c.allow('a', 5 * MIN)).toBe(false)
        expect(c.allow('b', 5 * MIN)).toBe(true)
        expect(c.allow('a', 10 * MIN)).toBe(true)
    })
})
