/**
 * 策略回测
 *
 * 在历史日K上回放规则化策略，和「买入后一直持有」做对比，回答
 * 「如果过去这段时间一直按这条规则买卖，结果会怎样」。
 *
 * 口径与简化：
 * - 信号在收盘后产生，按次日开盘价成交（避免用当天收盘价买当天，产生未来函数）
 * - 满仓进出，不加杠杆、不做空、不分批
 * - 计入交易成本：佣金双边万三（最低 5 元），卖出另收千一印花税
 * - 最后一笔若仍持仓，按最后一根K线收盘价估值，标记为未平仓
 */

import { fetchKLine, type KLineData } from './market'

export type StrategyId = 'ma_cross' | 'breakout' | 'rsi_reversal' | 'stop_profit_loss'

export interface StrategyMeta {
    id: StrategyId
    name: string
    /** 用新手能懂的话说明买卖规则 */
    description: string
    params: Array<{ key: string; label: string; default: number; min: number; max: number; step: number }>
}

export const STRATEGIES: StrategyMeta[] = [
    {
        id: 'ma_cross',
        name: '均线金叉死叉',
        description:
            '短期均线上穿长期均线（金叉）次日开盘买入，下穿（死叉）次日开盘卖出。最经典的趋势跟随策略，优点是能吃到大波段，缺点是震荡市里来回挨打。',
        params: [
            { key: 'short', label: '短期均线', default: 5, min: 2, max: 60, step: 1 },
            { key: 'long', label: '长期均线', default: 20, min: 5, max: 250, step: 1 },
        ],
    },
    {
        id: 'breakout',
        name: '突破新高',
        description:
            '收盘创 N 日新高时次日开盘买入，跌破 M 日均线时卖出。追强势股的思路，牛市效率高，但容易买在阶段顶部。',
        params: [
            { key: 'lookback', label: '新高回看天数', default: 20, min: 5, max: 250, step: 1 },
            { key: 'maExit', label: '离场均线', default: 10, min: 3, max: 120, step: 1 },
        ],
    },
    {
        id: 'rsi_reversal',
        name: 'RSI 超卖反弹',
        description:
            'RSI 跌破超卖线时次日开盘买入，升破超买线时卖出。逆势抄底思路，适合箱体震荡，单边下跌时会越买越亏。',
        params: [
            { key: 'period', label: 'RSI 周期', default: 14, min: 3, max: 60, step: 1 },
            { key: 'buyBelow', label: '超卖线（买入）', default: 30, min: 5, max: 50, step: 1 },
            { key: 'sellAbove', label: '超买线（卖出）', default: 70, min: 50, max: 95, step: 1 },
        ],
    },
    {
        id: 'stop_profit_loss',
        name: '回调买入+止盈止损',
        description:
            '股价回踩到均线附近买入，之后固定百分比止盈或止损离场。复刻每日决策里「保守价入场 + 止损止盈」的逻辑，可以用来检验那套价位设定是否合理。',
        params: [
            { key: 'ma', label: '回踩均线', default: 10, min: 3, max: 60, step: 1 },
            { key: 'takeProfit', label: '止盈(%)', default: 10, min: 1, max: 100, step: 0.5 },
            { key: 'stopLoss', label: '止损(%)', default: 5, min: 1, max: 50, step: 0.5 },
        ],
    },
]

export interface BacktestTrade {
    entryDate: string
    entryPrice: number
    exitDate: string | null
    exitPrice: number | null
    exitReason: string
    returnPct: number
    holdDays: number
    open: boolean
}

export interface EquityPoint {
    date: string
    /** 策略净值，起点 1 */
    strategy: number
    /** 买入持有净值，起点 1 */
    benchmark: number
}

export interface BacktestResult {
    code: string
    /** 回测本金：为了至少能买得起 1 手，会按股价自动放大 */
    capital: number
    name: string
    strategy: StrategyId
    strategyName: string
    params: Record<string, number>
    startDate: string
    endDate: string
    barCount: number
    totalReturnPct: number
    benchmarkReturnPct: number
    annualizedPct: number | null
    maxDrawdownPct: number
    tradeCount: number
    winRate: number | null
    avgReturnPct: number | null
    avgHoldDays: number | null
    bestTradePct: number | null
    worstTradePct: number | null
    /** 持仓天数占总天数比例，低说明大部分时间空仓 */
    exposurePct: number
    totalFee: number
    trades: BacktestTrade[]
    equity: EquityPoint[]
    /** 一句话结论，给新手看 */
    verdict: string
}

const BUY_FEE_RATE = 0.0003
const SELL_FEE_RATE = 0.0003 + 0.001 // 佣金 + 印花税
const MIN_FEE = 5

function fee(amount: number, isSell: boolean): number {
    const commission = Math.max(amount * BUY_FEE_RATE, MIN_FEE)
    return isSell ? commission + amount * 0.001 : commission
}

function ma(closes: number[], period: number): (number | null)[] {
    return closes.map((_, i) => {
        if (i < period - 1) return null
        let sum = 0
        for (let j = i - period + 1; j <= i; j++) sum += closes[j]
        return sum / period
    })
}

function rsi(closes: number[], period: number): (number | null)[] {
    const out: (number | null)[] = [null]
    let avgGain = 0
    let avgLoss = 0
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1]
        const gain = Math.max(diff, 0)
        const loss = Math.max(-diff, 0)
        if (i <= period) {
            avgGain += gain / period
            avgLoss += loss / period
            out.push(i === period ? 100 - 100 / (1 + avgGain / (avgLoss || 1e-9)) : null)
            continue
        }
        avgGain = (avgGain * (period - 1) + gain) / period
        avgLoss = (avgLoss * (period - 1) + loss) / period
        out.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-9)))
    }
    return out
}

type Signal = { enter: boolean; exit: boolean; exitReason?: string }

/**
 * 逐根K线产出信号。holding 表示当前是否持仓，entryPrice 为持仓成本，
 * 返回的信号作用于「下一根K线开盘」。
 */
function buildSignalFn(
    id: StrategyId,
    p: Record<string, number>,
    data: KLineData[]
): (i: number, holding: boolean, entryPrice: number) => Signal {
    const closes = data.map((d) => d.close)
    switch (id) {
        case 'ma_cross': {
            const short = ma(closes, p.short)
            const long = ma(closes, p.long)
            return (i, holding) => {
                const s = short[i]
                const l = long[i]
                const ps = short[i - 1]
                const pl = long[i - 1]
                if (s === null || l === null || ps === null || pl === null) return { enter: false, exit: false }
                const goldCross = ps <= pl && s > l
                const deadCross = ps >= pl && s < l
                return { enter: !holding && goldCross, exit: holding && deadCross, exitReason: '均线死叉' }
            }
        }
        case 'breakout': {
            const exitMa = ma(closes, p.maExit)
            return (i, holding) => {
                if (i < p.lookback) return { enter: false, exit: false }
                const window = closes.slice(i - p.lookback, i)
                const isHigh = closes[i] > Math.max(...window)
                const m = exitMa[i]
                return {
                    enter: !holding && isHigh,
                    exit: holding && m !== null && closes[i] < m,
                    exitReason: `跌破MA${p.maExit}`,
                }
            }
        }
        case 'rsi_reversal': {
            const r = rsi(closes, p.period)
            return (i, holding) => {
                const v = r[i]
                if (v === null) return { enter: false, exit: false }
                return { enter: !holding && v < p.buyBelow, exit: holding && v > p.sellAbove, exitReason: 'RSI 超买' }
            }
        }
        case 'stop_profit_loss': {
            const m = ma(closes, p.ma)
            return (i, holding, entryPrice) => {
                const mv = m[i]
                if (mv === null) return { enter: false, exit: false }
                if (!holding) {
                    // 回踩：当日最低触及均线且收盘仍在均线上方（缩量回踩不破）
                    const touched = data[i].low <= mv && data[i].close >= mv
                    return { enter: touched, exit: false }
                }
                const change = ((closes[i] - entryPrice) / entryPrice) * 100
                if (change <= -p.stopLoss) return { enter: false, exit: true, exitReason: '触发止损' }
                if (change >= p.takeProfit) return { enter: false, exit: true, exitReason: '触发止盈' }
                return { enter: false, exit: false }
            }
        }
    }
}

export async function runBacktest(input: {
    code: string
    name: string
    strategy: StrategyId
    params?: Record<string, number>
    days?: number
}): Promise<BacktestResult> {
    const meta = STRATEGIES.find((s) => s.id === input.strategy)
    if (!meta) throw new Error(`未知策略：${input.strategy}`)
    const params: Record<string, number> = {}
    for (const def of meta.params) {
        const v = input.params?.[def.key]
        params[def.key] = Number.isFinite(v) ? (v as number) : def.default
    }
    if (input.strategy === 'ma_cross' && params.short >= params.long) {
        throw new Error('短期均线必须小于长期均线')
    }

    const days = Math.min(1000, Math.max(60, input.days ?? 250))
    const data = await fetchKLine(input.code, days)
    if (data.length < 30) throw new Error('历史K线太少，无法回测')

    const signalFn = buildSignalFn(input.strategy, params, data)

    // 一手 = 100 股。本金太小会买不起高价股（如茅台 1 手就要 12 万），这里按区间内最高价自适应
    const maxClose = Math.max(...data.map((d) => d.close))
    const CAPITAL = Math.max(100_000, Math.ceil((maxClose * 100 * 1.05) / 10_000) * 10_000)
    let cash = CAPITAL
    let shares = 0
    let entryPrice = 0
    let entryDate = ''
    let entryIndex = 0
    let totalFee = 0
    let holdingBars = 0
    const trades: BacktestTrade[] = []
    const equity: EquityPoint[] = []
    const benchBase = data[0].close

    const closePosition = (i: number, price: number, reason: string) => {
        const amount = shares * price
        const f = fee(amount, true)
        totalFee += f
        cash += amount - f
        trades.push({
            entryDate,
            entryPrice,
            exitDate: data[i].date,
            exitPrice: price,
            exitReason: reason,
            returnPct: ((price - entryPrice) / entryPrice) * 100,
            holdDays: i - entryIndex,
            open: false,
        })
        shares = 0
    }

    // i 根K线的信号在 i+1 根开盘执行
    for (let i = 0; i < data.length; i++) {
        if (shares > 0) holdingBars++
        const sig = signalFn(i, shares > 0, entryPrice)
        const next = data[i + 1]
        if (next) {
            if (shares > 0 && sig.exit) {
                closePosition(i + 1, next.open, sig.exitReason ?? '策略卖出')
            } else if (shares === 0 && sig.enter) {
                const price = next.open
                const f = fee(cash, false)
                const buyable = Math.floor((cash - f) / price / 100) * 100 // A股按手
                if (buyable > 0) {
                    const amount = buyable * price
                    const realFee = fee(amount, false)
                    totalFee += realFee
                    cash -= amount + realFee
                    shares = buyable
                    entryPrice = price
                    entryDate = next.date
                    entryIndex = i + 1
                }
            }
        }
        const value = cash + shares * data[i].close
        equity.push({
            date: data[i].date,
            strategy: value / CAPITAL,
            benchmark: data[i].close / benchBase,
        })
    }

    // 收尾：仍持仓则按最后收盘价估值，记为未平仓
    const last = data[data.length - 1]
    if (shares > 0) {
        trades.push({
            entryDate,
            entryPrice,
            exitDate: null,
            exitPrice: last.close,
            exitReason: '仍持仓',
            returnPct: ((last.close - entryPrice) / entryPrice) * 100,
            holdDays: data.length - 1 - entryIndex,
            open: true,
        })
    }

    const finalValue = cash + shares * last.close
    const totalReturnPct = (finalValue / CAPITAL - 1) * 100
    const benchmarkReturnPct = (last.close / benchBase - 1) * 100

    let peak = -Infinity
    let maxDrawdownPct = 0
    for (const p of equity) {
        peak = Math.max(peak, p.strategy)
        if (peak > 0) maxDrawdownPct = Math.min(maxDrawdownPct, (p.strategy - peak) / peak)
    }
    maxDrawdownPct *= 100

    const closedTrades = trades.filter((t) => !t.open)
    const returns = trades.map((t) => t.returnPct)
    const wins = closedTrades.filter((t) => t.returnPct > 0).length
    const yearFrac = data.length / 244
    const annualizedPct =
        yearFrac >= 0.25 && finalValue > 0 ? ((finalValue / CAPITAL) ** (1 / yearFrac) - 1) * 100 : null

    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : null
    const avgReturnPct = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : null
    const excess = totalReturnPct - benchmarkReturnPct

    const verdictParts: string[] = []
    if (trades.length === 0) {
        verdictParts.push('这段时间内策略一次信号都没触发，等于全程空仓，说明参数对这只票过于严格')
    } else {
        verdictParts.push(
            excess >= 0
                ? `策略比一直持有多赚 ${excess.toFixed(1)} 个百分点`
                : `策略比一直持有少赚 ${Math.abs(excess).toFixed(1)} 个百分点`
        )
        if (winRate !== null) verdictParts.push(`共 ${trades.length} 笔交易、胜率 ${winRate.toFixed(0)}%`)
        verdictParts.push(`最大回撤 ${maxDrawdownPct.toFixed(1)}%`)
        if (totalFee > 0 && Math.abs(totalReturnPct) > 0) {
            verdictParts.push(`交易成本共 ${totalFee.toFixed(0)} 元（占本金 ${((totalFee / CAPITAL) * 100).toFixed(2)}%）`)
        }
    }

    return {
        code: input.code,
        capital: CAPITAL,
        name: input.name,
        strategy: input.strategy,
        strategyName: meta.name,
        params,
        startDate: data[0].date,
        endDate: last.date,
        barCount: data.length,
        totalReturnPct,
        benchmarkReturnPct,
        annualizedPct,
        maxDrawdownPct,
        tradeCount: trades.length,
        winRate,
        avgReturnPct,
        avgHoldDays:
            trades.length > 0 ? trades.reduce((a, t) => a + t.holdDays, 0) / trades.length : null,
        bestTradePct: returns.length > 0 ? Math.max(...returns) : null,
        worstTradePct: returns.length > 0 ? Math.min(...returns) : null,
        exposurePct: (holdingBars / data.length) * 100,
        totalFee,
        trades: trades.slice().reverse(),
        equity,
        verdict: verdictParts.join('；') + '。',
    }
}
