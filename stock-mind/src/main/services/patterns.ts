/**
 * 技术形态（选股用）与 技术信号（监控用）
 *
 * - 形态 Pattern：回答「这只票现在处于什么状态」，选股时对最新一根 K 线判定，可多选组合。
 * - 信号 Signal：回答「刚刚发生了什么」，带买/卖方向，监控池每根新 K 线判定一次。
 *
 * 全部是纯函数，输入按时间升序的 K 线，最后一根为最新。
 */

import {
    calcBoll,
    calcKDJ,
    calcMA,
    calcMACD,
    calcRSI,
    calcTD,
    crossDown,
    crossUp,
    detectDivergence,
    type Bar,
} from '../../shared/indicators'

export type PatternId =
    | 'ma_bull'
    | 'above_ma20'
    | 'above_ma60'
    | 'breakout_20'
    | 'breakout_55'
    | 'volume_breakout'
    | 'macd_golden'
    | 'kdj_golden_low'
    | 'pullback_ma20'
    | 'rsi_oversold'
    | 'consecutive_up'
    | 'tight_consolidation'
    | 'bottom_divergence'
    | 'td9_buy'

export interface PatternMeta {
    id: PatternId
    name: string
    /** 给新手看的白话解释 */
    description: string
    /** 至少需要多少根日K */
    minBars: number
}

export interface PatternHit {
    id: PatternId
    reason: string
}

type PatternTest = (bars: Bar[]) => string | null

const closesOf = (bars: Bar[]) => bars.map((b) => b.close)
const last = <T>(arr: T[]) => arr[arr.length - 1]
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

/** 最近 within 根内是否出现过 a 上穿 b */
function crossedUpWithin(a: (number | null)[], b: (number | null)[], within: number): number | null {
    for (let i = a.length - 1; i >= Math.max(1, a.length - within); i--) {
        if (crossUp(a, b, i)) return a.length - 1 - i
    }
    return null
}

const PATTERN_DEFS: Array<PatternMeta & { test: PatternTest }> = [
    {
        id: 'ma_bull',
        name: '均线多头排列',
        description: 'MA5 > MA10 > MA20 > MA60，短中长期趋势同向向上，是最典型的强势结构。',
        minBars: 60,
        test: (bars) => {
            const c = closesOf(bars)
            const [m5, m10, m20, m60] = [5, 10, 20, 60].map((p) => last(calcMA(c, p)))
            if (m5 == null || m10 == null || m20 == null || m60 == null) return null
            return m5 > m10 && m10 > m20 && m20 > m60 ? `MA5 ${m5} > MA10 ${m10} > MA20 ${m20} > MA60 ${m60}` : null
        },
    },
    {
        id: 'above_ma20',
        name: '站上 20 日线',
        description: '收盘价在 20 日均线上方，中短期趋势偏多。',
        minBars: 20,
        test: (bars) => {
            const m = last(calcMA(closesOf(bars), 20))
            const c = last(bars).close
            return m != null && c > m ? `收盘 ${c} 高于 MA20 ${m}` : null
        },
    },
    {
        id: 'above_ma60',
        name: '站上 60 日线',
        description: '收盘价在 60 日均线（季线）上方，中期趋势偏多。',
        minBars: 60,
        test: (bars) => {
            const m = last(calcMA(closesOf(bars), 60))
            const c = last(bars).close
            return m != null && c > m ? `收盘 ${c} 高于 MA60 ${m}` : null
        },
    },
    {
        id: 'breakout_20',
        name: '突破 20 日新高',
        description: '收盘价创近 20 个交易日新高，短线资金在主动推升。',
        minBars: 21,
        test: (bars) => {
            const prevHigh = Math.max(...bars.slice(-21, -1).map((b) => b.high))
            const c = last(bars).close
            return c > prevHigh ? `收盘 ${c} 突破前 20 日最高 ${prevHigh}` : null
        },
    },
    {
        id: 'breakout_55',
        name: '海龟突破（55 日新高）',
        description: '收盘价创近 55 日新高，海龟交易法的长周期入场信号，趋势更确定但位置更高。',
        minBars: 56,
        test: (bars) => {
            const prevHigh = Math.max(...bars.slice(-56, -1).map((b) => b.high))
            const c = last(bars).close
            return c > prevHigh ? `收盘 ${c} 突破前 55 日最高 ${prevHigh}` : null
        },
    },
    {
        id: 'volume_breakout',
        name: '放量突破',
        description: '当日上涨且成交量超过前 5 日均量 2 倍，同时收盘创 20 日新高。量价齐升，突破更可信。',
        minBars: 21,
        test: (bars) => {
            const today = last(bars)
            const prev = bars[bars.length - 2]
            const vol5 = avg(bars.slice(-6, -1).map((b) => b.volume))
            const prevHigh = Math.max(...bars.slice(-21, -1).map((b) => b.high))
            if (!prev || vol5 <= 0) return null
            const ratio = today.volume / vol5
            return today.close > prev.close && ratio >= 2 && today.close > prevHigh
                ? `放量 ${ratio.toFixed(1)} 倍并突破 20 日高点 ${prevHigh}`
                : null
        },
    },
    {
        id: 'macd_golden',
        name: 'MACD 金叉',
        description: '近 3 根 K 线内 DIF 上穿 DEA，动能由弱转强。零轴上方的金叉更强。',
        minBars: 35,
        test: (bars) => {
            const { dif, dea } = calcMACD(closesOf(bars))
            const ago = crossedUpWithin(dif, dea, 3)
            if (ago === null) return null
            const d = last(dif) ?? 0
            return `${ago === 0 ? '今日' : `${ago} 天前`}金叉，DIF ${d}${d > 0 ? '（零轴上方）' : ''}`
        },
    },
    {
        id: 'kdj_golden_low',
        name: 'KDJ 低位金叉',
        description: '近 3 根内 K 上穿 D，且 D 值低于 30，超卖区的反弹信号。',
        minBars: 15,
        test: (bars) => {
            const { k, d } = calcKDJ(bars)
            const ago = crossedUpWithin(k, d, 3)
            const dv = d[d.length - 1 - (ago ?? 0)]
            return ago !== null && dv != null && dv < 30 ? `${ago === 0 ? '今日' : `${ago} 天前`}金叉，D=${dv}` : null
        },
    },
    {
        id: 'pullback_ma20',
        name: '缩量回踩 20 日线',
        description: '上升趋势中最低价触及 MA20 但收盘守住，且成交量低于 5 日均量，常见的低吸位置。',
        minBars: 25,
        test: (bars) => {
            const ma20 = calcMA(closesOf(bars), 20)
            const m = last(ma20)
            const m5ago = ma20[ma20.length - 6]
            const t = last(bars)
            const vol5 = avg(bars.slice(-6, -1).map((b) => b.volume))
            if (m == null || m5ago == null) return null
            const rising = m > m5ago
            return rising && t.low <= m * 1.01 && t.close >= m && t.volume < vol5
                ? `MA20 ${m} 向上，最低 ${t.low} 触及后收在 ${t.close}`
                : null
        },
    },
    {
        id: 'rsi_oversold',
        name: 'RSI 超卖',
        description: 'RSI(14) 低于 30，短期跌得较多，可能有技术性反弹，但单边下跌里会持续超卖。',
        minBars: 15,
        test: (bars) => {
            const r = last(calcRSI(closesOf(bars)))
            return r != null && r < 30 ? `RSI14 = ${r}` : null
        },
    },
    {
        id: 'consecutive_up',
        name: '三连阳',
        description: '连续 3 天收阳且收盘逐日抬高，短线情绪持续。',
        minBars: 4,
        test: (bars) => {
            const recent = bars.slice(-3)
            const ok = recent.every((b, i) => b.close > b.open && (i === 0 || b.close > recent[i - 1].close))
            if (!ok) return null
            const base = bars[bars.length - 4].close
            return `3 日累计 ${pct(((last(bars).close - base) / base) * 100)}`
        },
    },
    {
        id: 'tight_consolidation',
        name: '窄幅整理',
        description: '近 10 日最高最低差小于 8%，且成交量萎缩，处于蓄势阶段，等待方向选择。',
        minBars: 20,
        test: (bars) => {
            const recent = bars.slice(-10)
            const hi = Math.max(...recent.map((b) => b.high))
            const lo = Math.min(...recent.map((b) => b.low))
            const range = ((hi - lo) / lo) * 100
            const volRecent = avg(recent.map((b) => b.volume))
            const volPrior = avg(bars.slice(-20, -10).map((b) => b.volume))
            return range < 8 && volRecent < volPrior ? `10 日振幅 ${range.toFixed(1)}%，量能收缩` : null
        },
    },
    {
        id: 'bottom_divergence',
        name: 'MACD 底背离',
        description: '价格创新低但 MACD 的 DIF 没有创新低，下跌动能减弱。需要后续放量确认。',
        minBars: 40,
        test: (bars) => {
            const { dif } = calcMACD(closesOf(bars))
            const div = detectDivergence(bars, dif).filter((d) => d.type === 'bottom')
            const latest = last(div)
            // 只认最近 5 根内确认的背离
            return latest && bars.length - 1 - latest.index <= 5
                ? `${bars[latest.fromIndex].date.slice(5, 10)} → ${bars[latest.index].date.slice(5, 10)} 价格新低而 DIF 抬高`
                : null
        },
    },
    {
        id: 'td9_buy',
        name: '九转买入结构',
        description: '连续 9 天收盘低于 4 天前收盘（神奇九转低 9），下跌可能接近阶段尾声。',
        minBars: 13,
        test: (bars) => {
            const { buy } = calcTD(closesOf(bars))
            const n = last(buy)
            return n >= 8 ? `九转计数 ${n}` : null
        },
    },
]

export const PATTERNS: PatternMeta[] = PATTERN_DEFS.map(({ test: _t, ...meta }) => meta)

export const PATTERN_MIN_BARS = Math.max(...PATTERN_DEFS.map((p) => p.minBars))

/** 对一只票判定一组形态，返回命中的那些 */
export function evaluatePatterns(bars: Bar[], ids: PatternId[]): PatternHit[] {
    const hits: PatternHit[] = []
    for (const id of ids) {
        const def = PATTERN_DEFS.find((p) => p.id === id)
        if (!def || bars.length < def.minBars) continue
        const reason = def.test(bars)
        if (reason) hits.push({ id, reason })
    }
    return hits
}

// ─── 监控信号 ──────────────────────────────────────────────────────────

export type SignalId =
    | 'macd_golden'
    | 'macd_dead'
    | 'kdj_golden'
    | 'kdj_dead'
    | 'ma_golden'
    | 'ma_dead'
    | 'breakout_20'
    | 'break_ma20'
    | 'volume_surge'
    | 'rsi_oversold'
    | 'rsi_overbought'
    | 'boll_break_upper'
    | 'boll_break_lower'
    | 'td9_buy'
    | 'td9_sell'
    | 'bottom_divergence'
    | 'top_divergence'

export interface SignalMeta {
    id: SignalId
    name: string
    direction: 'buy' | 'sell'
    description: string
}

type SignalTest = (bars: Bar[], i: number) => string | null

const SIGNAL_DEFS: Array<SignalMeta & { test: SignalTest }> = [
    {
        id: 'macd_golden',
        name: 'MACD 金叉',
        direction: 'buy',
        description: 'DIF 上穿 DEA',
        test: (bars, i) => {
            const { dif, dea } = calcMACD(closesOf(bars))
            return crossUp(dif, dea, i) ? `DIF ${dif[i]} 上穿 DEA ${dea[i]}` : null
        },
    },
    {
        id: 'macd_dead',
        name: 'MACD 死叉',
        direction: 'sell',
        description: 'DIF 下穿 DEA',
        test: (bars, i) => {
            const { dif, dea } = calcMACD(closesOf(bars))
            return crossDown(dif, dea, i) ? `DIF ${dif[i]} 下穿 DEA ${dea[i]}` : null
        },
    },
    {
        id: 'kdj_golden',
        name: 'KDJ 金叉',
        direction: 'buy',
        description: 'K 上穿 D（D<50 时更有效）',
        test: (bars, i) => {
            const { k, d } = calcKDJ(bars)
            return crossUp(k, d, i) && (d[i] ?? 100) < 50 ? `K ${k[i]} 上穿 D ${d[i]}` : null
        },
    },
    {
        id: 'kdj_dead',
        name: 'KDJ 死叉',
        direction: 'sell',
        description: 'K 下穿 D（D>50 时更有效）',
        test: (bars, i) => {
            const { k, d } = calcKDJ(bars)
            return crossDown(k, d, i) && (d[i] ?? 0) > 50 ? `K ${k[i]} 下穿 D ${d[i]}` : null
        },
    },
    {
        id: 'ma_golden',
        name: '均线金叉',
        direction: 'buy',
        description: 'MA5 上穿 MA20',
        test: (bars, i) => {
            const c = closesOf(bars)
            const [m5, m20] = [calcMA(c, 5), calcMA(c, 20)]
            return crossUp(m5, m20, i) ? `MA5 ${m5[i]} 上穿 MA20 ${m20[i]}` : null
        },
    },
    {
        id: 'ma_dead',
        name: '均线死叉',
        direction: 'sell',
        description: 'MA5 下穿 MA20',
        test: (bars, i) => {
            const c = closesOf(bars)
            const [m5, m20] = [calcMA(c, 5), calcMA(c, 20)]
            return crossDown(m5, m20, i) ? `MA5 ${m5[i]} 下穿 MA20 ${m20[i]}` : null
        },
    },
    {
        id: 'breakout_20',
        name: '突破 20 周期新高',
        direction: 'buy',
        description: '收盘突破前 20 根最高价',
        test: (bars, i) => {
            if (i < 21) return null
            const highOf = (from: number, to: number) => Math.max(...bars.slice(from, to).map((b) => b.high))
            const prevHigh = highOf(i - 20, i)
            // 只在「刚突破」那根报：前一根还没突破它自己的 20 根前高
            const wasBelow = bars[i - 1].close <= highOf(i - 21, i - 1)
            return bars[i].close > prevHigh && wasBelow ? `收盘 ${bars[i].close} 突破 ${prevHigh}` : null
        },
    },
    {
        id: 'break_ma20',
        name: '跌破 20 周期均线',
        direction: 'sell',
        description: '收盘由上方跌破 MA20',
        test: (bars, i) => {
            const m = calcMA(closesOf(bars), 20)
            const c = closesOf(bars)
            return crossDown(c, m, i) ? `收盘 ${c[i]} 跌破 MA20 ${m[i]}` : null
        },
    },
    {
        id: 'volume_surge',
        name: '放量上涨',
        direction: 'buy',
        description: '成交量超过前 5 根均量 2.5 倍且收阳',
        test: (bars, i) => {
            if (i < 5) return null
            const vol5 = avg(bars.slice(i - 5, i).map((b) => b.volume))
            const ratio = vol5 > 0 ? bars[i].volume / vol5 : 0
            return ratio >= 2.5 && bars[i].close > bars[i].open ? `放量 ${ratio.toFixed(1)} 倍` : null
        },
    },
    {
        id: 'rsi_oversold',
        name: 'RSI 进入超卖',
        direction: 'buy',
        description: 'RSI14 跌破 30',
        test: (bars, i) => {
            const r = calcRSI(closesOf(bars))
            return r[i] != null && r[i - 1] != null && (r[i] as number) < 30 && (r[i - 1] as number) >= 30 ? `RSI14 = ${r[i]}` : null
        },
    },
    {
        id: 'rsi_overbought',
        name: 'RSI 进入超买',
        direction: 'sell',
        description: 'RSI14 升破 70',
        test: (bars, i) => {
            const r = calcRSI(closesOf(bars))
            return r[i] != null && r[i - 1] != null && (r[i] as number) > 70 && (r[i - 1] as number) <= 70 ? `RSI14 = ${r[i]}` : null
        },
    },
    {
        id: 'boll_break_upper',
        name: '突破布林上轨',
        direction: 'sell',
        description: '收盘站上布林上轨，短线偏热，注意回落',
        test: (bars, i) => {
            const { upper } = calcBoll(closesOf(bars))
            return crossUp(closesOf(bars), upper, i) ? `收盘 ${bars[i].close} > 上轨 ${upper[i]}` : null
        },
    },
    {
        id: 'boll_break_lower',
        name: '跌破布林下轨',
        direction: 'buy',
        description: '收盘跌破布林下轨，短线超跌，留意反抽',
        test: (bars, i) => {
            const { lower } = calcBoll(closesOf(bars))
            return crossDown(closesOf(bars), lower, i) ? `收盘 ${bars[i].close} < 下轨 ${lower[i]}` : null
        },
    },
    {
        id: 'td9_buy',
        name: '九转低 9',
        direction: 'buy',
        description: '神奇九转买入结构数到 9',
        test: (bars, i) => (calcTD(closesOf(bars)).buy[i] === 9 ? '连续 9 根收盘低于 4 根前' : null),
    },
    {
        id: 'td9_sell',
        name: '九转高 9',
        direction: 'sell',
        description: '神奇九转卖出结构数到 9',
        test: (bars, i) => (calcTD(closesOf(bars)).sell[i] === 9 ? '连续 9 根收盘高于 4 根前' : null),
    },
    {
        id: 'bottom_divergence',
        name: 'MACD 底背离',
        direction: 'buy',
        description: '价格新低而 DIF 抬高（拐点右侧 2 根确认）',
        test: (bars, i) => {
            const { dif } = calcMACD(closesOf(bars))
            // 拐点需要右侧 2 根确认，所以在 i 时确认的是 i-2 那个拐点
            const hit = detectDivergence(bars.slice(0, i + 1), dif.slice(0, i + 1)).find(
                (d) => d.type === 'bottom' && d.index === i - 2
            )
            return hit ? `${bars[hit.fromIndex].date.slice(5, 16)} → ${bars[hit.index].date.slice(5, 16)}` : null
        },
    },
    {
        id: 'top_divergence',
        name: 'MACD 顶背离',
        direction: 'sell',
        description: '价格新高而 DIF 走低（拐点右侧 2 根确认）',
        test: (bars, i) => {
            const { dif } = calcMACD(closesOf(bars))
            const hit = detectDivergence(bars.slice(0, i + 1), dif.slice(0, i + 1)).find(
                (d) => d.type === 'top' && d.index === i - 2
            )
            return hit ? `${bars[hit.fromIndex].date.slice(5, 16)} → ${bars[hit.index].date.slice(5, 16)}` : null
        },
    },
]

export const SIGNALS: SignalMeta[] = SIGNAL_DEFS.map(({ test: _t, ...meta }) => meta)

export const DEFAULT_SIGNAL_IDS: SignalId[] = ['macd_golden', 'macd_dead', 'ma_golden', 'ma_dead', 'breakout_20', 'break_ma20']

export interface SignalHit extends SignalMeta {
    detail: string
    barTime: string
    price: number
}

/** 判定第 i 根（默认最新一根）上触发了哪些信号 */
export function evaluateSignals(bars: Bar[], ids: SignalId[], i: number = bars.length - 1): SignalHit[] {
    if (i < 1 || i >= bars.length) return []
    const hits: SignalHit[] = []
    for (const def of SIGNAL_DEFS) {
        if (!ids.includes(def.id)) continue
        const detail = def.test(bars, i)
        if (!detail) continue
        const { test: _t, ...meta } = def
        hits.push({ ...meta, detail, barTime: bars[i].date, price: bars[i].close })
    }
    return hits
}

export interface SignalTradeEvent {
    code: string
    name: string
    period: string
    direction: 'buy' | 'sell'
    barTime: string
    price: number
}

export interface SignalRoundTrip {
    code: string
    name: string
    period: string
    entryTime: string
    entryPrice: number
    exitTime: string | null
    exitPrice: number | null
    returnPct: number | null
}

/**
 * 「买点开仓、卖点平仓」逐笔配对：同一股票同一周期，空仓遇买点开仓，持仓遇卖点平仓，
 * 持仓中的重复买点、空仓时的卖点都忽略。用来回答「按这些信号操作到底赚不赚钱」。
 */
export function pairSignalTrades(events: SignalTradeEvent[]): SignalRoundTrip[] {
    const sorted = [...events].sort((a, b) => a.barTime.localeCompare(b.barTime))
    const open = new Map<string, SignalRoundTrip>()
    const trips: SignalRoundTrip[] = []
    for (const e of sorted) {
        const key = `${e.code}|${e.period}`
        const cur = open.get(key)
        if (!cur && e.direction === 'buy') {
            const trip: SignalRoundTrip = {
                code: e.code,
                name: e.name,
                period: e.period,
                entryTime: e.barTime,
                entryPrice: e.price,
                exitTime: null,
                exitPrice: null,
                returnPct: null,
            }
            open.set(key, trip)
            trips.push(trip)
        } else if (cur && e.direction === 'sell') {
            cur.exitTime = e.barTime
            cur.exitPrice = e.price
            cur.returnPct = ((e.price - cur.entryPrice) / cur.entryPrice) * 100
            open.delete(key)
        }
    }
    return trips
}
