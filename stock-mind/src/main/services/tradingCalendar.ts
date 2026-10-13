/**
 * A 股交易日历与上海时区工具
 *
 * 为什么需要：之前判断「是否交易日」只用 getDay() 排除周末，节假日里的工作日
 * （如国庆、春节期间的周一到周五）会被误判成交易日，导致信号扫描、价格提醒、
 * 收盘复盘在休市日照常触发，产生无意义甚至误导性的结果。这里内置交易所公布的
 * 休市安排做精确判断，并统一「当前上海时间」的计算，避免各处手搓时区偏移。
 *
 * 维护：节假日安排由沪深交易所每年 12 月公布，需每年更新一次 CLOSED_DATES。
 * 数据来源：上交所「年度休市安排」(sse.com.cn/disclosure/dealinstruc/closed)。
 * 当前已覆盖 2025、2026；超出 CALENDAR_YEARS 的年份只能按周末判断。
 */

/**
 * 交易所公布的休市日（YYYY-MM-DD）。只需列出落在工作日的休市日——周末本就
 * 由 isWeekend 处理。列入周末也无副作用，但这里只保留工作日休市以保持精简。
 */
const CLOSED_DATES = new Set<string>([
    // ─── 2025 ───
    '2025-01-01', // 元旦
    // 春节 1/28(二)-2/4(二)
    '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-03', '2025-02-04',
    '2025-04-04', // 清明 4/4(五)
    // 劳动节 5/1(四)-5/5(一)
    '2025-05-01', '2025-05-02', '2025-05-05',
    '2025-06-02', // 端午 5/31(六)-6/2(一)
    // 国庆+中秋 10/1(三)-10/8(三)
    '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-06', '2025-10-07', '2025-10-08',

    // ─── 2026 ───
    // 元旦 1/1(四)-1/3(六)
    '2026-01-01', '2026-01-02',
    // 春节 2/15(日)-2/23(一)
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
    '2026-04-06', // 清明 4/4(六)-4/6(一)
    // 劳动节 5/1(五)-5/5(二)
    '2026-05-01', '2026-05-04', '2026-05-05',
    '2026-06-19', // 端午 6/19(五)-6/21(日)
    '2026-09-25', // 中秋 9/25(五)-9/27(日)
    // 国庆 10/1(四)-10/7(三)
    '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
])

/** 已覆盖休市数据的年份区间；超出范围时只能按周末判断，调用方可据此提示「日历待更新」。 */
export const CALENDAR_YEARS = { min: 2025, max: 2026 }

/** 当前上海时间（东八区），与运行机器的本地时区无关。 */
export function shanghaiNow(): Date {
    return new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60_000)
}

/** 上海时间的 YYYY-MM-DD；offsetDays 为向前回溯的自然日天数。 */
export function shanghaiDateStr(offsetDays = 0, base: Date = shanghaiNow()): string {
    const d = new Date(base.getTime() - offsetDays * 86_400_000)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

function isWeekend(date: Date): boolean {
    const day = date.getDay()
    return day === 0 || day === 6
}

/** 是否 A 股交易日：排除周末与交易所公布的休市日。 */
export function isTradingDay(date: Date = shanghaiNow()): boolean {
    if (isWeekend(date)) return false
    return !CLOSED_DATES.has(shanghaiDateStr(0, date))
}

/** A 股交易时段：交易日 9:30-11:30、13:00-15:00（含节假日判断）。 */
export function isTradingTime(now: Date = shanghaiNow()): boolean {
    if (!isTradingDay(now)) return false
    const minutes = now.getHours() * 60 + now.getMinutes()
    return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900)
}
