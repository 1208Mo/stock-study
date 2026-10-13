/**
 * 持仓收益分析
 *
 * 用交易流水（holding_trades）回放每天的持仓数量和投入资金，再乘以日 K 收盘价，
 * 得到历史每日市值和收益曲线，并与沪深300 对比。不依赖每日快照，打开即有历史。
 *
 * 局限：
 * - 编辑持仓（直接改数量/成本）不会产生流水，回放数量与当前数量不一致时，
 *   把差额视为最早一笔交易日按当前均价买入/卖出的调整。
 * - 删除的持仓连同流水一起删除，已清仓并删除的股票不计入。
 */

import { fetchKLine, fetchBatchQuotes, type KLineData } from './market'
import { fetchIndexKLine } from './marketRegime'
import { getAllHoldings } from '../db'

export interface PortfolioHistoryPoint {
    date: string
    marketValue: number
    /** 累计净投入 = 买入金额 − 卖出金额 */
    netInvested: number
    /** 总盈亏 = 市值 − 净投入（含已实现） */
    pnl: number
    /** 收益率 = 总盈亏 / 历史最高净投入 */
    returnPct: number
    benchmarkPct: number
}

export interface PositionAnalytics {
    code: string
    name: string
    sector: string
    quantity: number
    avgCost: number
    price: number
    marketValue: number
    weight: number
    unrealizedPnl: number
    unrealizedPct: number
    realizedPnl: number
    todayPct: number
}

export interface PortfolioAnalytics {
    benchmarkName: string
    history: PortfolioHistoryPoint[]
    positions: PositionAnalytics[]
    sectors: Array<{ name: string; marketValue: number; weight: number }>
    totals: {
        marketValue: number
        unrealizedPnl: number
        realizedPnl: number
        totalPnl: number
        returnPct: number | null
        benchmarkPct: number | null
        maxDrawdownPct: number | null
        sellCount: number
        winningSells: number
    }
    warnings: Array<{ level: 'high' | 'medium'; text: string }>
    generatedAt: string
}

interface Trade {
    date: string
    type: 'buy' | 'sell'
    price: number
    quantity: number
}

/** trade_date 由 SQLite datetime('now') 写入，是 UTC；转成上海日期 */
function toShanghaiDate(raw: string): string {
    const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
    const t = Date.parse(iso)
    if (Number.isNaN(t)) return raw.slice(0, 10)
    return new Date(t + 8 * 3600_000).toISOString().slice(0, 10)
}

function replayRealized(trades: Trade[]): { realized: number; sells: number; wins: number } {
    let qty = 0
    let avg = 0
    let realized = 0
    let sells = 0
    let wins = 0
    for (const t of trades) {
        if (t.type === 'buy') {
            avg = qty + t.quantity > 0 ? (avg * qty + t.price * t.quantity) / (qty + t.quantity) : 0
            qty += t.quantity
        } else {
            const q = Math.min(t.quantity, qty)
            const pnl = (t.price - avg) * q
            realized += pnl
            sells++
            if (pnl > 0) wins++
            qty -= q
        }
    }
    return { realized, sells, wins }
}

let cache: { value: PortfolioAnalytics; key: string; expiresAt: number } | null = null

export async function computePortfolioAnalytics(days: number = 250): Promise<PortfolioAnalytics> {
    const holdings = getAllHoldings()
    const cacheKey = `${days}:${holdings.map((h) => `${h.id}-${h.quantity}-${h.trades.length}`).join(',')}`
    if (cache && cache.key === cacheKey && cache.expiresAt > Date.now()) return cache.value

    const [benchK, quotes, ...klines] = await Promise.all([
        fetchIndexKLine('sh000300', days).catch(() => [] as KLineData[]),
        fetchBatchQuotes(holdings.map((h) => h.code)).catch(() => []),
        ...holdings.map((h) => fetchKLine(h.code, days).catch(() => [] as KLineData[])),
    ])
    const quoteMap = new Map(quotes.map((q) => [q.code, q]))

    const positions: PositionAnalytics[] = []
    let realizedTotal = 0
    let sellCount = 0
    let winningSells = 0
    const perHolding: Array<{ trades: Trade[]; closes: Map<string, number> }> = []

    holdings.forEach((h, i) => {
        const trades: Trade[] = h.trades
            .map((t) => ({
                date: toShanghaiDate(t.trade_date),
                type: t.trade_type,
                price: t.cost_price,
                quantity: t.quantity,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))

        // 回放数量与当前数量对不上（手动编辑过持仓）时，补一笔调整交易
        const replayQty = trades.reduce((s, t) => s + (t.type === 'buy' ? t.quantity : -t.quantity), 0)
        const diff = h.quantity - replayQty
        if (diff !== 0) {
            const date = trades[0]?.date ?? toShanghaiDate(h.created_at)
            trades.unshift({ date, type: diff > 0 ? 'buy' : 'sell', price: h.avg_cost_price, quantity: Math.abs(diff) })
        }

        const r = replayRealized(trades)
        realizedTotal += r.realized
        sellCount += r.sells
        winningSells += r.wins

        const closes = new Map(klines[i].map((k) => [k.date.slice(0, 10), k.close]))
        perHolding.push({ trades, closes })

        const q = quoteMap.get(h.code)
        const lastClose = klines[i].length ? klines[i][klines[i].length - 1].close : h.avg_cost_price
        const price = q?.price ?? lastClose
        const marketValue = price * h.quantity
        const unrealized = (price - h.avg_cost_price) * h.quantity
        positions.push({
            code: h.code,
            name: h.name,
            sector: h.sector || '未分类',
            quantity: h.quantity,
            avgCost: h.avg_cost_price,
            price,
            marketValue,
            weight: 0,
            unrealizedPnl: unrealized,
            unrealizedPct: h.avg_cost_price > 0 ? ((price - h.avg_cost_price) / h.avg_cost_price) * 100 : 0,
            realizedPnl: r.realized,
            todayPct: q?.changePercent ?? 0,
        })
    })

    const totalMV = positions.reduce((s, p) => s + p.marketValue, 0)
    for (const p of positions) p.weight = totalMV > 0 ? (p.marketValue / totalMV) * 100 : 0
    positions.sort((a, b) => b.marketValue - a.marketValue)

    const sectorMap = new Map<string, number>()
    for (const p of positions) sectorMap.set(p.sector, (sectorMap.get(p.sector) ?? 0) + p.marketValue)
    const sectors = [...sectorMap.entries()]
        .map(([name, mv]) => ({ name, marketValue: mv, weight: totalMV > 0 ? (mv / totalMV) * 100 : 0 }))
        .sort((a, b) => b.marketValue - a.marketValue)

    // ── 历史曲线 ──
    const dates = benchK.map((k) => k.date.slice(0, 10))
    const benchClose = new Map(benchK.map((k) => [k.date.slice(0, 10), k.close]))
    const history: PortfolioHistoryPoint[] = []
    const lastPrice = perHolding.map(() => 0)
    let peakInvested = 0
    let benchBase: number | null = null

    for (const date of dates) {
        let mv = 0
        let invested = 0
        let hasPosition = false
        perHolding.forEach((ph, i) => {
            const c = ph.closes.get(date)
            if (c) lastPrice[i] = c
            let qty = 0
            for (const t of ph.trades) {
                if (t.date > date) break
                const sign = t.type === 'buy' ? 1 : -1
                qty += sign * t.quantity
                invested += sign * t.price * t.quantity
            }
            if (qty > 0) hasPosition = true
            // 停牌或数据缺失时用最近一次收盘价，再没有就用成本价
            const px = lastPrice[i] || ph.trades.find((t) => t.date <= date)?.price || 0
            mv += qty * px
        })
        if (!hasPosition && history.length === 0) continue
        peakInvested = Math.max(peakInvested, invested)
        const bc = benchClose.get(date)
        if (benchBase === null && bc) benchBase = bc
        const pnl = mv - invested
        history.push({
            date,
            marketValue: mv,
            netInvested: invested,
            pnl,
            returnPct: peakInvested > 0 ? (pnl / peakInvested) * 100 : 0,
            benchmarkPct: benchBase && bc ? (bc / benchBase - 1) * 100 : 0,
        })
    }

    // 最大回撤：以 (1 + 收益率) 作为净值序列
    let maxDrawdownPct: number | null = null
    if (history.length > 1) {
        let peak = -Infinity
        let mdd = 0
        for (const p of history) {
            const nav = 1 + p.returnPct / 100
            peak = Math.max(peak, nav)
            if (peak > 0) mdd = Math.min(mdd, (nav - peak) / peak)
        }
        maxDrawdownPct = mdd * 100
    }

    const unrealizedTotal = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
    const last = history[history.length - 1]

    // ── 风险提示 ──
    const warnings: PortfolioAnalytics['warnings'] = []
    const held = positions.filter((p) => p.quantity > 0)
    const top = held[0]
    if (top && top.weight > 30 && held.length > 1) {
        warnings.push({
            level: top.weight > 50 ? 'high' : 'medium',
            text: `${top.name} 占总仓位 ${top.weight.toFixed(0)}%，单只股票超过 30%，它一旦大跌会明显拖累整体收益。`,
        })
    }
    const topSector = sectors[0]
    if (topSector && topSector.weight > 50 && sectors.length > 1) {
        warnings.push({
            level: topSector.weight > 70 ? 'high' : 'medium',
            text: `「${topSector.name}」板块占 ${topSector.weight.toFixed(0)}%，行业过于集中，同板块股票往往同涨同跌。`,
        })
    }
    if (held.length > 0 && held.length <= 2) {
        warnings.push({ level: 'medium', text: `只持有 ${held.length} 只股票，分散度低。新手一般建议 4~8 只、分属不同行业。` })
    }
    for (const p of held) {
        if (p.unrealizedPct <= -15) {
            warnings.push({
                level: p.unrealizedPct <= -25 ? 'high' : 'medium',
                text: `${p.name} 浮亏 ${p.unrealizedPct.toFixed(1)}%，回顾一下买入理由是否还成立、止损计划是否执行。`,
            })
        }
    }
    if (maxDrawdownPct !== null && maxDrawdownPct < -20) {
        warnings.push({ level: 'medium', text: `组合最大回撤 ${maxDrawdownPct.toFixed(1)}%，波动较大，可考虑降低仓位或加入防守型资产。` })
    }

    const value: PortfolioAnalytics = {
        benchmarkName: '沪深300',
        history,
        positions,
        sectors,
        totals: {
            marketValue: totalMV,
            unrealizedPnl: unrealizedTotal,
            realizedPnl: realizedTotal,
            totalPnl: unrealizedTotal + realizedTotal,
            returnPct: last ? last.returnPct : null,
            benchmarkPct: last ? last.benchmarkPct : null,
            maxDrawdownPct,
            sellCount,
            winningSells,
        },
        warnings,
        generatedAt: new Date().toISOString(),
    }
    cache = { value, key: cacheKey, expiresAt: Date.now() + 60_000 }
    return value
}
