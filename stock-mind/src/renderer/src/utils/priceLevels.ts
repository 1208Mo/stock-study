import type { KLineData } from '../types'

export interface PriceLevels {
    aggressiveEntry: number
    conservativeEntry: number
    stopLoss: number
    takeProfit1: number
    takeProfit2: number
    basis: 'kline' | 'formula'
    // 一句话说明现价相对这些静态技术位的位置
    positionHint: string
    notes: {
        aggressive: string
        conservative: string
        stop: string
        tp1: string
        tp2: string
    }
}

function fmt(p: number) {
    return p >= 10 ? p.toFixed(2) : p.toFixed(3)
}

function ma(closes: number[], period: number): number | null {
    if (closes.length < period) return null
    const slice = closes.slice(-period)
    return slice.reduce((a, b) => a + b, 0) / period
}

function recentLow(klines: KLineData[], lookback: number): number | null {
    if (klines.length === 0) return null
    const slice = klines.slice(-lookback)
    if (slice.length === 0) return null
    return Math.min(...slice.map((k) => k.low))
}

function recentHigh(klines: KLineData[], lookback: number): number | null {
    if (klines.length === 0) return null
    const slice = klines.slice(-lookback)
    if (slice.length === 0) return null
    return Math.max(...slice.map((k) => k.high))
}

/**
 * 全部价位都来自 K 线（收盘价均线、swing 高低点、周月线支撑压力），
 * **不用现价做任何缩放**——一天只在收盘刷新，日内不会跟随现价跳动。
 *
 * 现价 (price) 仅用于：
 *   1) 从若干候选静态位里选出"位于现价下方"（作为可挂单支撑）或"位于现价上方"（作为止盈压力）
 *   2) 给 positionHint 说明当前处于哪个区域（例如"已突破近20日高点，无短期回踩买点"）
 *
 * K 线数据不足（日K <20 根）时降级为按现价比例，UI 会显示"基于现价比例"的标签，
 * 提示用户等 K 线加载完再看。
 */
export function computePriceLevels(
    price: number,
    isEtf: boolean,
    dailyKlines?: KLineData[],
    weeklyKlines?: KLineData[],
    monthlyKlines?: KLineData[]
): PriceLevels {
    const hasDaily = dailyKlines && dailyKlines.length >= 20
    if (!hasDaily) {
        return {
            aggressiveEntry: price * (isEtf ? 0.995 : 0.99),
            conservativeEntry: price * (isEtf ? 0.985 : 0.975),
            stopLoss: price * (isEtf ? 0.97 : 0.963),
            takeProfit1: price * (isEtf ? 1.025 : 1.04),
            takeProfit2: price * (isEtf ? 1.05 : 1.08),
            basis: 'formula',
            positionHint: 'K线暂未加载，价位按现价比例临时估算，会随现价跳动',
            notes: {
                aggressive: `现价 × ${isEtf ? '0.995' : '0.990'}（K线未加载）`,
                conservative: `现价 × ${isEtf ? '0.985' : '0.975'}`,
                stop: `现价 × ${isEtf ? '0.970' : '0.963'}`,
                tp1: `现价 × ${isEtf ? '1.025' : '1.040'}`,
                tp2: `现价 × ${isEtf ? '1.050' : '1.080'}`,
            },
        }
    }

    const daily = dailyKlines!
    const closes = daily.map((k) => k.close)
    const ma5 = ma(closes, 5)
    const ma10 = ma(closes, 10)
    const ma20 = ma(closes, 20)
    const ma60 = ma(closes, 60)
    const swingLow20 = recentLow(daily, 20)
    const swingHigh20 = recentHigh(daily, 20)
    const swingHigh60 = recentHigh(daily, 60)
    const recentLow5 = recentLow(daily, 5)
    const weeklyLow12 =
        weeklyKlines && weeklyKlines.length > 0 ? recentLow(weeklyKlines, 12) : null
    const weeklyHigh24 =
        weeklyKlines && weeklyKlines.length > 0 ? recentHigh(weeklyKlines, 24) : null
    const monthlyLow24 =
        monthlyKlines && monthlyKlines.length > 0 ? recentLow(monthlyKlines, 24) : null

    // ── 激进挂：MA5（浅回踩买点）───────────────────────────────────
    // MA5 是最新5根收盘均值，一天只更新一次。若 MA5 已在现价上方（阴跌趋势），
    // 用近5日低点作为激进挂位。
    let aggressiveEntry: number
    let aggressiveNote: string
    if (ma5 != null && ma5 <= price) {
        aggressiveEntry = ma5
        aggressiveNote = `日线 MA5 ¥${fmt(ma5)}（浅回踩买点，K线静态位）`
    } else if (recentLow5 != null) {
        aggressiveEntry = recentLow5
        aggressiveNote = `近5日低点 ¥${fmt(recentLow5)}（MA5 已在现价上方，改用近期低点）`
    } else {
        aggressiveEntry = ma5 ?? price
        aggressiveNote = ma5 != null ? `日线 MA5 ¥${fmt(ma5)}` : 'K线不足'
    }

    // ── 保守挂：MA10 / MA20 / 周线12周低点（更深的中期支撑）─────────
    // 从"日线 MA10、MA20、周线12周低点"里挑最接近现价、且位于现价下方的静态位。
    // 若都在现价上方，则退到"三个位里最低的那个"（说明现价已经很弱势）。
    const conservativePool: Array<{ v: number; label: string }> = []
    if (ma10 != null) conservativePool.push({ v: ma10, label: `日线 MA10 ¥${fmt(ma10)}` })
    if (ma20 != null) conservativePool.push({ v: ma20, label: `日线 MA20 ¥${fmt(ma20)}（中期支撑）` })
    if (weeklyLow12 != null)
        conservativePool.push({ v: weeklyLow12, label: `周线12周低点 ¥${fmt(weeklyLow12)}` })

    const belowPrice = conservativePool.filter((it) => it.v < price).sort((a, b) => b.v - a.v)
    let conservativeEntry: number
    let conservativeNote: string
    if (belowPrice.length > 0) {
        // 选最接近现价的（贴身支撑）；再取一个次深的做参照
        const top = belowPrice[0]
        conservativeEntry = top.v
        conservativeNote = `${top.label}（K线静态位）`
    } else if (conservativePool.length > 0) {
        // 全都在现价上方 → 用最低的一个作参考（说明现价已在中期支撑之下）
        const lowest = [...conservativePool].sort((a, b) => a.v - b.v)[0]
        conservativeEntry = lowest.v
        conservativeNote = `${lowest.label}（现价已跌破所有中期支撑，此处偏参考）`
    } else {
        // K 线不足以给出中期支撑，退到激进挂下方
        conservativeEntry = aggressiveEntry
        conservativeNote = `K线中期支撑不足，与激进挂相同`
    }

    // ── 止损：MA60 / 20日 swing low / 月线24月主要低点 ─────────────
    // 从三者里挑最低的作为"跌破就止损"的破位线；再下移 1% 避免刚好触及被扫。
    // 全部都在现价上方（罕见，破位极深）则退到保守挂下方 5%。
    const stopPool: Array<{ v: number; label: string }> = []
    if (ma60 != null) stopPool.push({ v: ma60, label: `日线 MA60 ¥${fmt(ma60)}` })
    if (swingLow20 != null)
        stopPool.push({ v: swingLow20, label: `近20日低点 ¥${fmt(swingLow20)}` })
    if (monthlyLow24 != null)
        stopPool.push({ v: monthlyLow24, label: `月线24月主要低点 ¥${fmt(monthlyLow24)}` })

    const belowConservative = stopPool.filter((it) => it.v < conservativeEntry)
    let rawStop: number
    let stopNote: string
    if (belowConservative.length > 0) {
        // 取最低那个（真正的破位线），一般是月线主要低点或 MA60
        const lowest = [...belowConservative].sort((a, b) => a.v - b.v)[0]
        rawStop = lowest.v
        stopNote = `跌破${lowest.label} 走人`
    } else if (stopPool.length > 0) {
        // 保守挂下方无破位线，取整体最低者
        const lowest = [...stopPool].sort((a, b) => a.v - b.v)[0]
        rawStop = lowest.v
        stopNote = `跌破${lowest.label} 走人`
    } else {
        rawStop = conservativeEntry * 0.95
        stopNote = `保守挂下方 5%（K线支撑不足以定位破位线）`
    }
    // 止损略下移 1%，避免刚好触及即抛
    const stopLoss = rawStop * 0.99

    // ── 第一止盈：位于现价上方的最近一档压力 ─────────────────────
    // 优先近20日高点；若已被突破则用近60日高点；再不行用周线24周高点。
    const tp1Pool: Array<{ v: number; label: string }> = []
    if (swingHigh20 != null)
        tp1Pool.push({
            v: swingHigh20,
            label: `近20日高点 ¥${fmt(swingHigh20)}（近期压力）`,
        })
    if (swingHigh60 != null)
        tp1Pool.push({ v: swingHigh60, label: `近60日高点 ¥${fmt(swingHigh60)}` })
    if (weeklyHigh24 != null)
        tp1Pool.push({
            v: weeklyHigh24,
            label: `周线24周高点 ¥${fmt(weeklyHigh24)}（中期压力）`,
        })

    const abovePrice = tp1Pool.filter((it) => it.v > price).sort((a, b) => a.v - b.v)
    let takeProfit1: number
    let tp1Note: string
    if (abovePrice.length > 0) {
        // 挑最接近现价的（第一档压力）
        const nearest = abovePrice[0]
        takeProfit1 = nearest.v
        tp1Note = nearest.label
    } else {
        // 现价已突破所有已知压力，用最高的一档做参考
        const highest = [...tp1Pool].sort((a, b) => b.v - a.v)[0]
        takeProfit1 = highest ? highest.v : price
        tp1Note = highest
            ? `${highest.label}（现价已突破，暂无近期压力位）`
            : `K线压力不足`
    }

    // ── 第二止盈：更高一档压力 ────────────────────────────────────
    const tp2Pool = tp1Pool.filter((it) => it.v > takeProfit1 * 1.005)
    let takeProfit2: number
    let tp2Note: string
    if (tp2Pool.length > 0) {
        const next = tp2Pool.sort((a, b) => a.v - b.v)[0]
        takeProfit2 = next.v
        tp2Note = next.label
    } else if (weeklyHigh24 != null && weeklyHigh24 > takeProfit1) {
        takeProfit2 = weeklyHigh24
        tp2Note = `周线24周高点 ¥${fmt(weeklyHigh24)}`
    } else {
        // 兜底：第一止盈之上按 K 线波幅（近60日振幅）再放一点
        const range =
            swingHigh60 != null && swingLow20 != null ? swingHigh60 - swingLow20 : takeProfit1 * 0.08
        takeProfit2 = takeProfit1 + range * 0.5
        tp2Note = `第一止盈 + 半个近期波幅（K线暂无更高压力）`
    }

    // ── 现价位置提示 ─────────────────────────────────────────────
    let positionHint = ''
    if (ma20 != null && price < ma20) {
        positionHint = `现价 ¥${fmt(price)} 已跌破日线 MA20，处于中期弱势区`
    } else if (swingHigh20 != null && price >= swingHigh20 * 0.995) {
        positionHint = `现价 ¥${fmt(price)} 已接近或突破近20日高点，短期回踩买点已消失`
    } else if (ma5 != null && ma10 != null && price >= ma5 && ma5 >= ma10) {
        positionHint = `现价 ¥${fmt(price)} 站在 MA5 上方，短期趋势向上`
    } else if (ma20 != null) {
        positionHint = `现价 ¥${fmt(price)} 位于日线 MA20 上方，中期趋势偏强`
    }

    return {
        aggressiveEntry,
        conservativeEntry,
        stopLoss,
        takeProfit1,
        takeProfit2,
        basis: 'kline',
        positionHint,
        notes: {
            aggressive: aggressiveNote,
            conservative: conservativeNote,
            stop: stopNote,
            tp1: tp1Note,
            tp2: tp2Note,
        },
    }
}
