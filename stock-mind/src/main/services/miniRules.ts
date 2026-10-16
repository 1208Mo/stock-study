/**
 * 小屏盯盘的提醒规则（纯函数，便于单测）
 *
 * - 涨速异动：最近 N 分钟内价格变动超过阈值（类似行情软件的「5 分钟涨速」）。
 * - 成本线：相对持仓成本达到止盈 / 止损百分比。
 * - 尾盘提醒：交易日 14:50 之后提醒一次，留出收盘前的操作时间。
 * - 冷却：同一条规则在冷却期内只触发一次，避免反复刷屏。
 */

export interface PriceSample {
    t: number
    price: number
}

/** 追加采样并丢掉超出保留窗口的旧数据（原地修改并返回同一数组）。 */
export function pushSample(history: PriceSample[], sample: PriceSample, keepMs: number): PriceSample[] {
    history.push(sample)
    const cutoff = sample.t - keepMs
    let drop = 0
    while (drop < history.length && history[drop].t < cutoff) drop++
    if (drop > 0) history.splice(0, drop)
    return history
}

/**
 * 窗口内涨速（%）：最新价相对窗口内最早一个采样的变化。
 * 采样跨度不足 minSpanMs 时返回 null —— 刚启动只有几秒数据时不该判定为异动。
 */
export function surgePercent(
    history: PriceSample[],
    now: number,
    windowMs: number,
    minSpanMs = 60_000
): number | null {
    if (history.length < 2) return null
    const start = now - windowMs
    const base = history.find((s) => s.t >= start)
    const last = history[history.length - 1]
    if (!base || base === last || base.price <= 0) return null
    if (last.t - base.t < minSpanMs) return null
    return ((last.price - base.price) / base.price) * 100
}

export type CostLineHit = 'take_profit' | 'stop_loss' | null

/**
 * 成本线判定。takeProfitPct / stopLossPct 均为正数，0 表示关闭该规则。
 * 例如 stopLossPct=5 表示「相对成本亏损达到 5%」。
 */
export function checkCostLine(price: number, cost: number, takeProfitPct: number, stopLossPct: number): CostLineHit {
    if (!(cost > 0) || !(price > 0)) return null
    const pct = ((price - cost) / cost) * 100
    if (takeProfitPct > 0 && pct >= takeProfitPct) return 'take_profit'
    if (stopLossPct > 0 && pct <= -stopLossPct) return 'stop_loss'
    return null
}

/** 尾盘提醒时段：14:50-15:00（调用方负责先判断交易日）。now 为上海时间。 */
export function isCloseReminderTime(now: Date): boolean {
    const minutes = now.getHours() * 60 + now.getMinutes()
    return minutes >= 890 && minutes < 900
}

/** 按 key 冷却：冷却期内 allow 返回 false。 */
export class Cooldown {
    private last = new Map<string, number>()

    constructor(private readonly ms: number) {}

    allow(key: string, now: number): boolean {
        const prev = this.last.get(key)
        if (prev !== undefined && now - prev < this.ms) return false
        this.last.set(key, now)
        return true
    }

    clear(): void {
        this.last.clear()
    }
}
