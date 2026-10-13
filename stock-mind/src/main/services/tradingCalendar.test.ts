import { describe, it, expect } from 'vitest'
import { isTradingDay, isTradingTime } from './tradingCalendar'

// 用本地时间分量构造 Date，使 getDay/getDate/getHours 不受测试机器时区影响。
const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm)

describe('isTradingDay', () => {
    it('普通工作日为交易日', () => {
        expect(isTradingDay(at(2026, 10, 12))).toBe(true) // 周一
        expect(isTradingDay(at(2026, 10, 8))).toBe(true) // 国庆后首个交易日(周四)
        expect(isTradingDay(at(2025, 2, 5))).toBe(true) // 春节后开市(周三)
    })

    it('周末不是交易日', () => {
        expect(isTradingDay(at(2026, 10, 10))).toBe(false) // 周六
        expect(isTradingDay(at(2026, 10, 11))).toBe(false) // 周日
    })

    it('节假日里的工作日不是交易日', () => {
        expect(isTradingDay(at(2026, 10, 1))).toBe(false) // 国庆(周四)
        expect(isTradingDay(at(2026, 10, 2))).toBe(false) // 国庆(周五)
        expect(isTradingDay(at(2026, 2, 17))).toBe(false) // 春节(周二)
        expect(isTradingDay(at(2025, 1, 1))).toBe(false) // 元旦(周三)
        expect(isTradingDay(at(2025, 5, 1))).toBe(false) // 劳动节(周四)
    })
})

describe('isTradingTime', () => {
    const tradingDay = (hh: number, mm = 0) => isTradingTime(at(2026, 10, 12, hh, mm))

    it('交易时段内为真', () => {
        expect(tradingDay(10, 0)).toBe(true) // 上午
        expect(tradingDay(14, 59)).toBe(true) // 收盘前
    })

    it('午休与盘前盘后为假', () => {
        expect(tradingDay(9, 0)).toBe(false) // 盘前
        expect(tradingDay(12, 0)).toBe(false) // 午休
        expect(tradingDay(15, 30)).toBe(false) // 盘后
    })

    it('休市日即使在交易时段也为假', () => {
        expect(isTradingTime(at(2026, 10, 1, 10, 0))).toBe(false) // 国庆
        expect(isTradingTime(at(2026, 10, 10, 10, 0))).toBe(false) // 周六
    })
})
