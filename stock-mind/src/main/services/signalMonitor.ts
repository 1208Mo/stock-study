/**
 * 技术信号监控
 *
 * - 监控池（signal_watch）与自选股解耦：只盯真正想盯的票，每只可单独选周期和信号。
 * - 交易时段每 60 秒扫描一次；收盘后 15:00~15:15 再补扫一次，把当天日K的信号定格。
 * - 同一只票、同一周期、同一根K线的同一信号只提醒一次（数据库 UNIQUE 去重）。
 * - 盘中按「正在走的那根K线」判定，收盘前信号可能消失；流水里记录的是首次触发时的价格。
 * - 加入监控池时会用最近 120 根K线回填历史信号（标记为已读、不弹通知），让收益统计立刻有样本。
 */

import { BrowserWindow, Notification } from 'electron'
import { fetchBatchQuotes, fetchKLineEx, type KLinePeriod } from './market'
import { isTradingTime, isTradingDay, shanghaiNow, shanghaiDateStr } from './tradingCalendar'
import {
    DEFAULT_SIGNAL_IDS,
    SIGNALS,
    evaluateSignals,
    pairSignalTrades,
    type SignalId,
    type SignalRoundTrip,
} from './patterns'
import {
    countUnreadSignalEvents,
    flushSignals,
    getSetting,
    insertSignalEvent,
    listSignalEventsForStats,
    listSignalWatch,
    markSignalWatchScanned,
    type SignalWatchRow,
} from '../db'

export interface SignalHooks {
    openRoute: (route: string) => void
    sendToPet: (message: string) => void
}

const SCAN_INTERVAL_MS = 60_000
const BARS = 150
const BACKFILL_BARS = 120
export const MONITOR_PERIODS: KLinePeriod[] = ['5m', '15m', '30m', '60m', 'day', 'week']
const PERIOD_TEXT: Record<string, string> = { '5m': '5分', '15m': '15分', '30m': '30分', '60m': '60分', day: '日K', week: '周K' }

export function periodText(p: string): string {
    return PERIOD_TEXT[p] ?? p
}

function parseList(s: string | null | undefined): string[] {
    return (s ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
}

export function getSignalDefaults(): { periods: KLinePeriod[]; signals: SignalId[]; enabled: boolean } {
    const periods = parseList(getSetting('signal_default_periods')).filter((p): p is KLinePeriod =>
        MONITOR_PERIODS.includes(p as KLinePeriod)
    )
    const valid = new Set(SIGNALS.map((s) => s.id))
    const signals = parseList(getSetting('signal_default_signals')).filter((s): s is SignalId => valid.has(s as SignalId))
    return {
        periods: periods.length ? periods : ['day'],
        signals: signals.length ? signals : DEFAULT_SIGNAL_IDS,
        enabled: getSetting('signal_monitor_enabled') !== '0',
    }
}

function resolveWatch(w: SignalWatchRow, defaults: ReturnType<typeof getSignalDefaults>) {
    const periods = parseList(w.periods).filter((p): p is KLinePeriod => MONITOR_PERIODS.includes(p as KLinePeriod))
    const valid = new Set(SIGNALS.map((s) => s.id))
    const signals = parseList(w.signals).filter((s): s is SignalId => valid.has(s as SignalId))
    return {
        periods: periods.length ? periods : defaults.periods,
        signals: signals.length ? signals : defaults.signals,
    }
}

function broadcast(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
}

interface NewSignal {
    code: string
    name: string
    period: string
    signalName: string
    direction: 'buy' | 'sell'
    price: number
    detail: string
}

async function scanOne(
    w: SignalWatchRow,
    defaults: ReturnType<typeof getSignalDefaults>,
    backfill: boolean
): Promise<NewSignal[]> {
    const { periods, signals } = resolveWatch(w, defaults)
    const fresh: NewSignal[] = []
    for (const period of periods) {
        let bars
        try {
            bars = (await fetchKLineEx(w.code, period, 'qfq', BARS)).bars
        } catch {
            continue
        }
        const from = backfill ? Math.max(1, bars.length - BACKFILL_BARS) : bars.length - 1
        for (let i = from; i < bars.length; i++) {
            for (const hit of evaluateSignals(bars, signals, i)) {
                const isNew = insertSignalEvent(
                    {
                        code: w.code,
                        name: w.name,
                        period,
                        signal_id: hit.id,
                        signal_name: hit.name,
                        direction: hit.direction,
                        bar_time: hit.barTime,
                        price: hit.price,
                        detail: hit.detail,
                    },
                    backfill
                )
                // 回填的历史信号只入库不提醒
                if (isNew && !backfill) {
                    fresh.push({
                        code: w.code,
                        name: w.name,
                        period,
                        signalName: hit.name,
                        direction: hit.direction,
                        price: hit.price,
                        detail: hit.detail,
                    })
                }
            }
        }
    }
    return fresh
}

let scanning = false

export async function scanSignals(
    hooks: SignalHooks,
    options: { force?: boolean; backfill?: boolean; watchIds?: number[] } = {}
): Promise<{ scanned: number; fired: number }> {
    const defaults = getSignalDefaults()
    // 回填走独立通道，不被周期扫描的互斥挡住
    if (scanning && !options.backfill) return { scanned: 0, fired: 0 }
    if (!options.force && (!defaults.enabled || !isTradingTime())) return { scanned: 0, fired: 0 }
    if (!options.backfill) scanning = true
    try {
        let pool = listSignalWatch().filter((w) => w.enabled)
        if (options.watchIds) pool = pool.filter((w) => options.watchIds!.includes(w.id))
        if (pool.length === 0) return { scanned: 0, fired: 0 }

        const fresh: NewSignal[] = []
        let cursor = 0
        const worker = async () => {
            while (cursor < pool.length) {
                const w = pool[cursor++]
                fresh.push(...(await scanOne(w, defaults, !!options.backfill)))
            }
        }
        await Promise.all(Array.from({ length: Math.min(4, pool.length) }, worker))
        markSignalWatchScanned(pool.map((w) => w.id))
        flushSignals()

        if (fresh.length > 0) notify(hooks, fresh)
        if (fresh.length > 0 || options.backfill) broadcast('signals:changed', { unread: countUnreadSignalEvents() })
        return { scanned: pool.length, fired: fresh.length }
    } catch (e) {
        console.error('Signal scan error:', e)
        return { scanned: 0, fired: 0 }
    } finally {
        if (!options.backfill) scanning = false
    }
}

function notify(hooks: SignalHooks, fresh: NewSignal[]): void {
    const line = (s: NewSignal) =>
        `${s.direction === 'buy' ? '买点' : '卖点'}｜${s.name} ${periodText(s.period)} ${s.signalName}，${s.price}`
    // 同一轮触发太多时合并成一条，避免通知刷屏
    if (fresh.length > 3) {
        const buys = fresh.filter((s) => s.direction === 'buy').length
        const n = new Notification({
            title: `📈 ${fresh.length} 个技术信号`,
            body: `${buys} 个买点、${fresh.length - buys} 个卖点\n${fresh.slice(0, 3).map(line).join('\n')}…`,
        })
        n.on('click', () => hooks.openRoute('/alerts?tab=signals'))
        n.show()
        hooks.sendToPet(`📈 监控池触发了 ${fresh.length} 个技术信号`)
        return
    }
    for (const s of fresh) {
        const n = new Notification({ title: `📈 ${s.name} ${s.signalName}`, body: `${line(s)}\n${s.detail}` })
        n.on('click', () =>
            hooks.openRoute(`/stock/${s.code}?name=${encodeURIComponent(s.name)}&period=${encodeURIComponent(s.period)}`)
        )
        n.show()
        hooks.sendToPet(`📈 ${line(s)}`)
    }
}

// ─── 收益统计 ──────────────────────────────────────────────────────────

export interface SignalStatsSlice {
    key: string
    label: string
    trades: number
    closed: number
    wins: number
    winRate: number | null
    avgReturnPct: number | null
    /** 逐笔复利累计收益 */
    cumReturnPct: number
    open: number
}

export interface SignalStats {
    since: string | null
    overall: SignalStatsSlice
    byStock: SignalStatsSlice[]
    byPeriod: SignalStatsSlice[]
    trips: Array<SignalRoundTrip & { floatingPct: number | null }>
}

function slice(key: string, label: string, trips: Array<SignalRoundTrip & { floatingPct: number | null }>): SignalStatsSlice {
    const closed = trips.filter((t) => t.returnPct !== null)
    const wins = closed.filter((t) => (t.returnPct as number) > 0).length
    const cum = closed.reduce((acc, t) => acc * (1 + (t.returnPct as number) / 100), 1)
    return {
        key,
        label,
        trades: trips.length,
        closed: closed.length,
        wins,
        winRate: closed.length ? (wins / closed.length) * 100 : null,
        avgReturnPct: closed.length ? closed.reduce((a, t) => a + (t.returnPct as number), 0) / closed.length : null,
        cumReturnPct: (cum - 1) * 100,
        open: trips.length - closed.length,
    }
}

export async function computeSignalStats(q: { since?: string; code?: string; period?: string } = {}): Promise<SignalStats> {
    const events = listSignalEventsForStats({ since: q.since, keyword: q.code, period: q.period })
    const trips = pairSignalTrades(
        events.map((e) => ({ code: e.code, name: e.name, period: e.period, direction: e.direction, barTime: e.bar_time, price: e.price }))
    )
    // 持仓中的配对用最新价算浮动收益
    const openCodes = [...new Set(trips.filter((t) => t.exitTime === null).map((t) => t.code))]
    const quotes = openCodes.length ? await fetchBatchQuotes(openCodes).catch(() => []) : []
    const priceOf = new Map(quotes.map((x) => [x.code, x.price]))
    const withFloat = trips.map((t) => {
        const p = priceOf.get(t.code)
        return { ...t, floatingPct: t.exitTime === null && p ? ((p - t.entryPrice) / t.entryPrice) * 100 : null }
    })

    const group = (keyOf: (t: SignalRoundTrip) => string, labelOf: (t: SignalRoundTrip) => string) => {
        const m = new Map<string, typeof withFloat>()
        for (const t of withFloat) {
            const k = keyOf(t)
            m.set(k, [...(m.get(k) ?? []), t])
        }
        return [...m.entries()]
            .map(([k, ts]) => slice(k, labelOf(ts[0]), ts))
            .sort((a, b) => b.trades - a.trades)
    }

    return {
        since: q.since ?? null,
        overall: slice('all', '全部', withFloat),
        byStock: group((t) => t.code, (t) => `${t.name}（${t.code}）`),
        byPeriod: group((t) => t.period, (t) => periodText(t.period)),
        trips: withFloat.reverse().slice(0, 200),
    }
}

let lastCloseScanDate = ''

export function startSignalMonitor(hooks: SignalHooks): void {
    setInterval(() => {
        void scanSignals(hooks)
        // 收盘后补扫一次：用 15:00 收盘后的完整日K再判定一遍
        const now = shanghaiNow()
        const minutes = now.getHours() * 60 + now.getMinutes()
        const date = shanghaiDateStr(0, now)
        if (isTradingDay(now) && minutes > 900 && minutes <= 915 && lastCloseScanDate !== date) {
            lastCloseScanDate = date
            if (getSignalDefaults().enabled) void scanSignals(hooks, { force: true })
        }
    }, SCAN_INTERVAL_MS)
}
