/**
 * 技术指标纯函数（主进程选股/信号监控 与 渲染进程 K 线图共用）
 *
 * 约定：输入按时间升序；输出数组与输入等长，数据不足的位置为 null。
 * 这里不依赖 Node / DOM，方便单元测试。
 */

export interface Bar {
    date: string
    open: number
    close: number
    high: number
    low: number
    volume: number
}

export type Series = (number | null)[]

const round = (v: number, d: number) => parseFloat(v.toFixed(d))

export function calcMA(closes: number[], period: number): Series {
    let sum = 0
    return closes.map((c, i) => {
        sum += c
        if (i >= period) sum -= closes[i - period]
        return i < period - 1 ? null : round(sum / period, 3)
    })
}

// EMA：首个值用第一根收盘价做种子
export function calcEMA(closes: number[], period: number): number[] {
    const k = 2 / (period + 1)
    const result: number[] = []
    for (let i = 0; i < closes.length; i++) {
        result.push(i === 0 ? closes[0] : round(closes[i] * k + result[i - 1] * (1 - k), 3))
    }
    return result
}

export function calcMACD(closes: number[]): { dif: Series; dea: Series; bar: Series } {
    const ema12 = calcEMA(closes, 12)
    const ema26 = calcEMA(closes, 26)
    // DIF 在第 26 根之后才有意义
    const difRaw = closes.map((_, i) => round(ema12[i] - ema26[i], 3))
    const k = 2 / (9 + 1)
    const deaRaw: number[] = []
    for (let i = 0; i < difRaw.length; i++) {
        if (i < 25) deaRaw.push(0)
        else if (i === 25) deaRaw.push(difRaw[i])
        else deaRaw.push(round(difRaw[i] * k + deaRaw[i - 1] * (1 - k), 3))
    }
    return {
        dif: difRaw.map((v, i) => (i < 25 ? null : v)),
        dea: deaRaw.map((v, i) => (i < 25 ? null : v)),
        bar: difRaw.map((v, i) => (i < 25 ? null : round((v - deaRaw[i]) * 2, 3))),
    }
}

// KDJ(9,3,3)：RSV 的 3 日平滑为 K，K 的 3 日平滑为 D，J = 3K − 2D
export function calcKDJ(data: Bar[], period = 9): { k: Series; d: Series; j: Series } {
    const k: Series = []
    const d: Series = []
    const j: Series = []
    let prevK = 50
    let prevD = 50
    data.forEach((bar, i) => {
        if (i < period - 1) {
            k.push(null)
            d.push(null)
            j.push(null)
            return
        }
        let high = -Infinity
        let low = Infinity
        for (let w = i - period + 1; w <= i; w++) {
            high = Math.max(high, data[w].high)
            low = Math.min(low, data[w].low)
        }
        const rsv = high === low ? 50 : ((bar.close - low) / (high - low)) * 100
        const curK = (2 / 3) * prevK + (1 / 3) * rsv
        const curD = (2 / 3) * prevD + (1 / 3) * curK
        prevK = curK
        prevD = curD
        k.push(round(curK, 2))
        d.push(round(curD, 2))
        j.push(round(3 * curK - 2 * curD, 2))
    })
    return { k, d, j }
}

// RSI：Wilder 平滑的涨跌幅均值
export function calcRSI(closes: number[], period = 14): Series {
    const out: Series = []
    let avgGain = 0
    let avgLoss = 0
    for (let i = 0; i < closes.length; i++) {
        if (i === 0) {
            out.push(null)
            continue
        }
        const diff = closes[i] - closes[i - 1]
        const gain = Math.max(diff, 0)
        const loss = Math.max(-diff, 0)
        if (i <= period) {
            avgGain += gain / period
            avgLoss += loss / period
            out.push(i === period ? round(100 - 100 / (1 + avgGain / (avgLoss || 1e-9)), 2) : null)
            continue
        }
        avgGain = (avgGain * (period - 1) + gain) / period
        avgLoss = (avgLoss * (period - 1) + loss) / period
        out.push(round(100 - 100 / (1 + avgGain / (avgLoss || 1e-9)), 2))
    }
    return out
}

// 布林带(20, 2)：中轨 MA20，上下轨为 ±2 倍标准差
export function calcBoll(closes: number[], period = 20, mult = 2): { mid: Series; upper: Series; lower: Series } {
    const mid = calcMA(closes, period)
    const upper: Series = []
    const lower: Series = []
    closes.forEach((_, i) => {
        const m = mid[i]
        if (m === null) {
            upper.push(null)
            lower.push(null)
            return
        }
        let variance = 0
        for (let w = i - period + 1; w <= i; w++) variance += (closes[w] - m) ** 2
        const sd = Math.sqrt(variance / period)
        upper.push(round(m + mult * sd, 3))
        lower.push(round(m - mult * sd, 3))
    })
    return { mid, upper, lower }
}

/** BBI 多空指标 = (MA3 + MA6 + MA12 + MA24) / 4；收盘在 BBI 上方偏多 */
export function calcBBI(closes: number[]): Series {
    const mas = [3, 6, 12, 24].map((p) => calcMA(closes, p))
    return closes.map((_, i) => {
        const vals = mas.map((m) => m[i])
        if (vals.some((v) => v === null)) return null
        return round((vals as number[]).reduce((a, b) => a + b, 0) / 4, 3)
    })
}
/**
 * 神奇九转（TD Sequential 的 Setup 部分）
 * - 买入结构：收盘连续低于 4 根前的收盘，数到 9 视为下跌动能衰竭
 * - 卖出结构：收盘连续高于 4 根前的收盘，数到 9 视为上涨动能衰竭
 * 中途断开即重新计数；数到 9 后下一根从 1 重新开始。
 */
export function calcTD(closes: number[]): { buy: number[]; sell: number[] } {
    const buy: number[] = []
    const sell: number[] = []
    let b = 0
    let s = 0
    for (let i = 0; i < closes.length; i++) {
        if (i < 4) {
            buy.push(0)
            sell.push(0)
            continue
        }
        b = closes[i] < closes[i - 4] ? (b >= 9 ? 1 : b + 1) : 0
        s = closes[i] > closes[i - 4] ? (s >= 9 ? 1 : s + 1) : 0
        buy.push(b)
        sell.push(s)
    }
    return { buy, sell }
}

/** a 在第 i 根上穿 b（前一根 a ≤ b，本根 a > b） */
export function crossUp(a: Series, b: Series, i: number): boolean {
    const [pa, pb, ca, cb] = [a[i - 1], b[i - 1], a[i], b[i]]
    return i > 0 && pa != null && pb != null && ca != null && cb != null && pa <= pb && ca > cb
}

export function crossDown(a: Series, b: Series, i: number): boolean {
    const [pa, pb, ca, cb] = [a[i - 1], b[i - 1], a[i], b[i]]
    return i > 0 && pa != null && pb != null && ca != null && cb != null && pa >= pb && ca < cb
}

/**
 * 局部极值点：左侧 left 根、右侧 right 根都不比它更极端。
 * right 越小越灵敏（最新的拐点更早确认），但假拐点也越多。
 */
export function findPivots(values: number[], kind: 'high' | 'low', left = 3, right = 2): number[] {
    const out: number[] = []
    for (let i = left; i < values.length - right; i++) {
        let ok = true
        for (let j = i - left; j <= i + right && ok; j++) {
            if (j === i) continue
            ok = kind === 'low' ? values[j] >= values[i] : values[j] <= values[i]
        }
        if (ok) out.push(i)
    }
    return out
}

export interface Divergence {
    /** 后一个拐点（背离确认点） */
    index: number
    /** 前一个拐点 */
    fromIndex: number
    /** bottom 底背离：价格新低而指标未新低（看涨）；top 顶背离：反之（看跌） */
    type: 'bottom' | 'top'
}

/**
 * 价格与指标背离检测：相邻两个价格拐点，价格创新低/新高而指标没有同步。
 * 两个拐点间隔太远（> maxGap 根）时不认为有关联。
 */
export function detectDivergence(data: Bar[], indicator: Series, maxGap = 60): Divergence[] {
    const out: Divergence[] = []
    const lows = findPivots(data.map((d) => d.low), 'low')
    const highs = findPivots(data.map((d) => d.high), 'high')
    for (let n = 1; n < lows.length; n++) {
        const [a, b] = [lows[n - 1], lows[n]]
        const [ia, ib] = [indicator[a], indicator[b]]
        if (b - a > maxGap || ia == null || ib == null) continue
        if (data[b].low < data[a].low && ib > ia) out.push({ index: b, fromIndex: a, type: 'bottom' })
    }
    for (let n = 1; n < highs.length; n++) {
        const [a, b] = [highs[n - 1], highs[n]]
        const [ia, ib] = [indicator[a], indicator[b]]
        if (b - a > maxGap || ia == null || ib == null) continue
        if (data[b].high > data[a].high && ib < ia) out.push({ index: b, fromIndex: a, type: 'top' })
    }
    return out.sort((x, y) => x.index - y.index)
}

export interface VolumeProfile {
    bins: Array<{ low: number; high: number; volume: number }>
    /** 成交最密集的价位（Point of Control） */
    poc: number
    /** 价值区上沿/下沿：围绕 POC 覆盖 70% 成交量的价格区间 */
    vah: number
    val: number
}

/**
 * 成交量分布（VPVR）：把区间内每根 K 线的成交量按其高低价均匀摊到价格桶里。
 */
export function calcVolumeProfile(data: Bar[], binCount = 24): VolumeProfile | null {
    if (data.length === 0) return null
    const lo = Math.min(...data.map((d) => d.low))
    const hi = Math.max(...data.map((d) => d.high))
    if (!(hi > lo)) return null
    const step = (hi - lo) / binCount
    const vols = new Array<number>(binCount).fill(0)
    for (const d of data) {
        const from = Math.min(binCount - 1, Math.floor((d.low - lo) / step))
        const to = Math.min(binCount - 1, Math.floor((d.high - lo) / step))
        const share = d.volume / (to - from + 1)
        for (let b = from; b <= to; b++) vols[b] += share
    }
    const bins = vols.map((volume, b) => ({ low: lo + b * step, high: lo + (b + 1) * step, volume }))
    let pocIdx = 0
    vols.forEach((v, b) => {
        if (v > vols[pocIdx]) pocIdx = b
    })
    // 从 POC 向两侧扩张，每次吞并成交量更大的一侧，直到覆盖 70%
    const total = vols.reduce((a, b) => a + b, 0)
    let [up, down, covered] = [pocIdx, pocIdx, vols[pocIdx]]
    while (covered < total * 0.7 && (up < binCount - 1 || down > 0)) {
        const nextUp = up < binCount - 1 ? vols[up + 1] : -1
        const nextDown = down > 0 ? vols[down - 1] : -1
        if (nextUp >= nextDown) covered += vols[++up]
        else covered += vols[--down]
    }
    return {
        bins,
        poc: round((bins[pocIdx].low + bins[pocIdx].high) / 2, 3),
        vah: round(bins[up].high, 3),
        val: round(bins[down].low, 3),
    }
}

/**
 * 涨跌停幅度（%）：主板 10%，创业板/科创板 20%，北交所 30%，ST 5%。
 * 按 2026 年规则粗分，不处理新股上市前 5 日不设涨跌幅等特殊情况。
 */
export function limitPercent(code: string, name = ''): number {
    if (/^(8|4|92)/.test(code)) return 30
    if (/^(300|301|688|689)/.test(code)) return 20
    if (/ST/i.test(name)) return 5
    return 10
}

/** 由昨收算涨停/跌停价（四舍五入到分） */
export function limitPrices(prevClose: number, code: string, name = ''): { up: number; down: number } {
    const p = limitPercent(code, name) / 100
    return { up: round(prevClose * (1 + p), 2), down: round(prevClose * (1 - p), 2) }
}
