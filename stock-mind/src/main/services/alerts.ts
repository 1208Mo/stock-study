/**
 * 价格提醒监控 + 菜单栏托盘盈亏
 *
 * - 交易时段每 20 秒检查一次启用中的提醒；非交易时段不请求行情。
 * - 单次提醒触发后自动停用；"每日重复"的提醒每天最多触发一次。
 * - 触发时：系统通知 + 桌宠气泡 + 写入提醒记录 + 推送给主窗口刷新未读数。
 * - 托盘（仅 macOS）：菜单栏标题显示持仓今日盈亏，菜单列出涨跌最大的持仓。
 */

import { app, BrowserWindow, Menu, Notification, Tray, nativeImage } from 'electron'
import { fetchBatchQuotes, type QuoteData } from './market'
import { shanghaiDateStr, isTradingTime } from './tradingCalendar'
import { routeToMini, toggleMiniWindow } from './miniTicker'
import {
    getAllHoldings,
    getSetting,
    setSetting,
    listActivePriceAlerts,
    recordAlertTriggered,
    countUnreadAlertEvents,
    type PriceAlertRow,
} from '../db'

export interface AlertHooks {
    openRoute: (route: string) => void
    sendToPet: (message: string) => void
}

const CHECK_INTERVAL_MS = 20_000
const TRAY_INTERVAL_MS = 30_000

function todayStr(): string {
    return shanghaiDateStr()
}

const KIND_TEXT: Record<PriceAlertRow['kind'], (t: number) => string> = {
    price_above: (t) => `涨到 ${t} 元`,
    price_below: (t) => `跌到 ${t} 元`,
    pct_above: (t) => `涨幅达到 ${t}%`,
    pct_below: (t) => `跌幅达到 ${t}%`,
}

export function describeAlert(alert: Pick<PriceAlertRow, 'kind' | 'target'>): string {
    return KIND_TEXT[alert.kind](alert.target)
}

function isHit(alert: PriceAlertRow, q: QuoteData): boolean {
    switch (alert.kind) {
        case 'price_above':
            return q.price >= alert.target
        case 'price_below':
            return q.price <= alert.target
        case 'pct_above':
            return q.changePercent >= alert.target
        case 'pct_below':
            return q.changePercent <= -Math.abs(alert.target)
    }
}

function broadcast(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
}

let checking = false

export async function checkPriceAlerts(hooks: AlertHooks, force = false): Promise<number> {
    if (checking || (!force && !isTradingTime())) return 0
    checking = true
    try {
        const today = todayStr()
        const alerts = listActivePriceAlerts().filter(
            (a) => !(a.repeat_daily && a.last_triggered_at?.startsWith(today))
        )
        if (alerts.length === 0) return 0

        const quotes = await fetchBatchQuotes([...new Set(alerts.map((a) => a.code))])
        const quoteMap = new Map(quotes.map((q) => [q.code, q]))
        let fired = 0
        for (const alert of alerts) {
            const q = quoteMap.get(alert.code)
            if (!q || !isHit(alert, q)) continue
            const sign = q.changePercent > 0 ? '+' : ''
            const message = `${alert.name} ${describeAlert(alert)}，现价 ${q.price}（${sign}${q.changePercent.toFixed(2)}%）${alert.note ? `｜${alert.note}` : ''}`
            recordAlertTriggered(alert, message, q.price)
            fired++

            // 小屏盯盘静默模式下改由小窗提示，不弹系统通知
            if (routeToMini({ code: alert.code, name: alert.name, text: `🔔 ${message}` })) continue
            const n = new Notification({ title: `🔔 ${alert.name} 价格提醒`, body: message })
            n.on('click', () => hooks.openRoute(`/stock/${alert.code}?name=${encodeURIComponent(alert.name)}`))
            n.show()
            hooks.sendToPet(`🔔 ${message}`)
        }
        if (fired > 0) broadcast('alerts:changed', { unread: countUnreadAlertEvents() })
        return fired
    } catch (e) {
        console.error('Price alert check error:', e)
        return 0
    } finally {
        checking = false
    }
}

// ─── 托盘 ──────────────────────────────────────────────────────────────

let tray: Tray | null = null
let trayTimer: NodeJS.Timeout | null = null
let trayHooks: AlertHooks | null = null
let lastTrayQuotesAt = 0

function signed(n: number, digits = 2): string {
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
}

async function refreshTray(force = false): Promise<void> {
    if (!tray || !trayHooks) return
    // 非交易时段每 10 分钟刷新一次即可
    if (!force && !isTradingTime() && Date.now() - lastTrayQuotesAt < 10 * 60_000) return

    const holdings = getAllHoldings()
    const hooks = trayHooks
    const baseItems: Electron.MenuItemConstructorOptions[] = [
        { label: '打开 StockMind', click: () => hooks.openRoute('/') },
        { label: '提醒中心', click: () => hooks.openRoute('/alerts') },
        { label: '显示/隐藏小屏盯盘', click: () => toggleMiniWindow() },
        { type: 'separator' },
        { label: '隐藏菜单栏盈亏', click: () => setTrayEnabled(false) },
        { label: '退出', click: () => app.quit() },
    ]

    if (holdings.length === 0) {
        tray.setTitle(' StockMind')
        tray.setContextMenu(Menu.buildFromTemplate(baseItems))
        return
    }

    let quotes: QuoteData[] = []
    try {
        quotes = await fetchBatchQuotes(holdings.map((h) => h.code))
        lastTrayQuotesAt = Date.now()
    } catch {
        return
    }
    if (!tray) return
    const qm = new Map(quotes.map((q) => [q.code, q]))

    let todayPnl = 0
    let prevValue = 0
    const rows: Array<{ code: string; name: string; pct: number; pnl: number }> = []
    for (const h of holdings) {
        const q = qm.get(h.code)
        if (!q) continue
        const pnl = q.change * h.quantity
        todayPnl += pnl
        prevValue += (q.price - q.change) * h.quantity
        rows.push({ code: h.code, name: h.name, pct: q.changePercent, pnl })
    }
    const todayPct = prevValue > 0 ? (todayPnl / prevValue) * 100 : 0
    const arrow = todayPnl > 0 ? '▲' : todayPnl < 0 ? '▼' : '•'
    tray.setTitle(` ${arrow} ${signed(todayPnl, 0)}`)
    tray.setToolTip(`StockMind 今日盈亏 ${signed(todayPnl)} 元（${signed(todayPct)}%）`)

    rows.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    const holdingItems: Electron.MenuItemConstructorOptions[] = rows.slice(0, 8).map((r) => ({
        label: `${r.name}  ${signed(r.pct)}%  ${signed(r.pnl, 0)} 元`,
        click: () => hooks.openRoute(`/stock/${r.code}?name=${encodeURIComponent(r.name)}`),
    }))

    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: `今日盈亏 ${signed(todayPnl)} 元（${signed(todayPct)}%）`, enabled: false },
            { type: 'separator' },
            ...holdingItems,
            { type: 'separator' },
            ...baseItems,
        ])
    )
}

export function startTray(hooks: AlertHooks): void {
    trayHooks = hooks
    if (process.platform !== 'darwin' || tray) return
    if (getSetting('tray_enabled') === '0') return
    tray = new Tray(nativeImage.createEmpty())
    tray.setTitle(' StockMind')
    refreshTray(true)
    trayTimer = setInterval(() => refreshTray(), TRAY_INTERVAL_MS)
}

export function stopTray(): void {
    if (trayTimer) clearInterval(trayTimer)
    trayTimer = null
    tray?.destroy()
    tray = null
}

export function setTrayEnabled(enabled: boolean): void {
    setSetting('tray_enabled', enabled ? '1' : '0')
    if (enabled && trayHooks) startTray(trayHooks)
    else stopTray()
}

export function startAlertMonitor(hooks: AlertHooks): void {
    setInterval(() => checkPriceAlerts(hooks), CHECK_INTERVAL_MS)
    startTray(hooks)
}
