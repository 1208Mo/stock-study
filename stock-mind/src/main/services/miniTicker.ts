/**
 * 小屏盯盘（摸鱼模式）
 *
 * 参考 VS Code「韭菜盒子」、IDEA leeks 插件、菜单栏行情工具的思路：信息尽量少、颜色可以低调、一键隐藏。
 * - 一个无边框、置顶、不抢焦点的小窗，只显示少量持仓/自选的现价与涨跌幅。
 * - 老板键（全局快捷键）：一键隐藏本应用所有窗口，再按一次恢复。
 * - 鼠标穿透：小窗不挡操作，只有鼠标移到顶部把手上时才可交互。
 * - 提醒规则：5 分钟涨速异动、持仓止盈/止损线、14:50 尾盘提醒，均带冷却/每日一次去重。
 * - 静默提醒：开启后不弹系统通知，提醒只在小窗内闪烁；价格提醒与技术信号也会改走小窗（见 routeToMini）。
 *
 * 行情请求复用 market.fetchQuote 的 3 秒缓存与在途去重，和托盘、价格提醒的轮询不会重复打上游。
 */

import { BrowserWindow, Menu, Notification, globalShortcut, screen } from 'electron'
import { join } from 'path'
import { fetchBatchQuotes } from './market'
import { fetchIndexTicker, type IndexTick } from './marketOverview'
import { isTradingDay, isTradingTime, shanghaiDateStr, shanghaiNow } from './tradingCalendar'
import { Cooldown, checkCostLine, isCloseReminderTime, pushSample, surgePercent, type PriceSample } from './miniRules'
import { getAllHoldings, getAllWatchlist, getSetting, setSetting } from '../db'

export interface MiniHooks {
    openRoute: (route: string) => void
    sendToPet: (message: string) => void
}

export interface MiniConfig {
    enabled: boolean
    /** 用户从持仓/自选里挑选的股票代码（按显示顺序）；为空时默认显示前几只持仓、再补自选 */
    codes: string[]
    /** 代码 → 名称，记住全网搜索加进来的票（不在持仓/自选里）的名称 */
    labels: Record<string, string>
    /** 窗口不透明度 0.3-1 */
    opacity: number
    /** 低调模式：灰度配色、用代码代替名称 */
    stealth: boolean
    /** 静默提醒：不弹系统通知，只在小窗内提示 */
    silent: boolean
    clickThrough: boolean
    /** Electron accelerator 格式，如 Alt+Shift+M；留空表示不注册 */
    bossKey: string
    /** 5 分钟涨速阈值（%），0 关闭 */
    surgePct: number
    /** 相对成本的止盈 / 止损百分比（正数），0 关闭 */
    takeProfitPct: number
    stopLossPct: number
    closeReminder: boolean
}

export const DEFAULT_MINI_CONFIG: MiniConfig = {
    enabled: false,
    codes: [],
    labels: {},
    opacity: 0.9,
    stealth: false,
    silent: true,
    clickThrough: false,
    bossKey: 'Alt+Shift+M',
    surgePct: 2,
    takeProfitPct: 10,
    stopLossPct: 5,
    closeReminder: true,
}

export interface MiniRow {
    code: string
    name: string
    price: number
    changePercent: number
    /** 相对持仓成本的盈亏 %，非持仓为 null */
    costPct: number | null
}

export interface MiniEvent {
    id: number
    code?: string
    name?: string
    text: string
    level: 'up' | 'down' | 'info'
    at: number
}

export interface MiniSnapshot {
    rows: MiniRow[]
    index: IndexTick | null
    trading: boolean
    updatedAt: number
    error: string | null
    events: MiniEvent[]
    config: MiniConfig
}

const FAST_INTERVAL_MS = 5_000
const IDLE_INTERVAL_MS = 60_000
const SURGE_WINDOW_MS = 5 * 60_000
const SURGE_COOLDOWN_MS = 15 * 60_000
const MAX_EVENTS = 20
const CONFIG_KEY = 'mini_config'
const BOUNDS_KEY = 'mini_bounds'
const DEFAULT_WIDTH = 240
/** 小窗最多盯几只；太多就失去「小屏」的意义了 */
export const MAX_CODES = 10
/** 未手动选择时默认显示的数量 */
const DEFAULT_ROWS = 5

let hooks: MiniHooks | null = null
let config: MiniConfig = { ...DEFAULT_MINI_CONFIG }
let win: BrowserWindow | null = null
let pollTimer: NodeJS.Timeout | null = null
let polling = false
let registeredKey: string | null = null
let bossHidden: BrowserWindow[] = []
let eventSeq = 0
let events: MiniEvent[] = []
let state: Omit<MiniSnapshot, 'events' | 'config'> = { rows: [], index: null, trading: false, updatedAt: 0, error: null }
const histories = new Map<string, PriceSample[]>()
const surgeCooldown = new Cooldown(SURGE_COOLDOWN_MS)
const firedToday = new Set<string>()

// ─── 配置 ──────────────────────────────────────────────────────────────

function clamp(n: unknown, min: number, max: number, fallback: number): number {
    const v = Number(n)
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

export function normalizeMiniConfig(raw: Partial<MiniConfig>): MiniConfig {
    const d = DEFAULT_MINI_CONFIG
    const codes = Array.isArray(raw.codes)
        ? [...new Set(raw.codes.map((c) => String(c).trim()).filter(Boolean))].slice(0, MAX_CODES)
        : d.codes
    // 只保留仍在列表里的名称，避免反复增删后无限膨胀
    const labels: Record<string, string> = {}
    const rawLabels = raw.labels && typeof raw.labels === 'object' ? raw.labels : {}
    for (const c of codes) if (typeof rawLabels[c] === 'string' && rawLabels[c]) labels[c] = rawLabels[c]
    return {
        enabled: raw.enabled ?? d.enabled,
        codes,
        labels,
        opacity: clamp(raw.opacity, 0.3, 1, d.opacity),
        stealth: raw.stealth ?? d.stealth,
        silent: raw.silent ?? d.silent,
        clickThrough: raw.clickThrough ?? d.clickThrough,
        bossKey: typeof raw.bossKey === 'string' ? raw.bossKey.trim() : d.bossKey,
        surgePct: clamp(raw.surgePct, 0, 20, d.surgePct),
        takeProfitPct: clamp(raw.takeProfitPct, 0, 500, d.takeProfitPct),
        stopLossPct: clamp(raw.stopLossPct, 0, 100, d.stopLossPct),
        closeReminder: raw.closeReminder ?? d.closeReminder,
    }
}

function loadConfig(): MiniConfig {
    try {
        return normalizeMiniConfig(JSON.parse(getSetting(CONFIG_KEY) || '{}'))
    } catch {
        return { ...DEFAULT_MINI_CONFIG }
    }
}

export function getMiniConfig(): MiniConfig {
    return config
}

// ─── 窗口 ──────────────────────────────────────────────────────────────

function rowCount(): number {
    return config.codes.length || DEFAULT_ROWS
}

function defaultHeight(): number {
    // 顶部把手 24 + 每行 22 + 底部提醒条 22 + 边距
    return 24 + rowCount() * 22 + 22 + 8
}

function loadBounds(): Electron.Rectangle {
    try {
        const b = JSON.parse(getSetting(BOUNDS_KEY) || 'null') as Electron.Rectangle | null
        // 外接屏拔掉后旧坐标可能落在屏幕外，此时回退到默认位置
        if (b && screen.getAllDisplays().some((d) => pointIn(d.workArea, b.x + 20, b.y + 10))) return b
    } catch {
        // ignore
    }
    const { workArea } = screen.getPrimaryDisplay()
    const height = defaultHeight()
    return { x: workArea.x + workArea.width - DEFAULT_WIDTH - 16, y: workArea.y + 16, width: DEFAULT_WIDTH, height }
}

function pointIn(r: Electron.Rectangle, x: number, y: number): boolean {
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
}

let saveBoundsTimer: NodeJS.Timeout | null = null
function saveBoundsSoon(): void {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) setSetting(BOUNDS_KEY, JSON.stringify(win.getBounds()))
    }, 500)
}

function isVisible(): boolean {
    return !!win && !win.isDestroyed() && win.isVisible()
}

function applyClickThrough(interactive: boolean): void {
    if (!win || win.isDestroyed()) return
    if (config.clickThrough && !interactive) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
}

/** 鼠标穿透模式下，渲染层在鼠标进入/离开顶部把手时调用。 */
export function setMiniInteractive(interactive: boolean): void {
    applyClickThrough(interactive)
}

function createMiniWindow(): void {
    if (win && !win.isDestroyed()) return
    const w = new BrowserWindow({
        ...loadBounds(),
        minWidth: 160,
        minHeight: 60,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        hasShadow: false,
        fullscreenable: false,
        maximizable: false,
        minimizable: false,
        show: false,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            // 被遮挡时也要继续接收推送并闪烁提醒
            backgroundThrottling: false,
        },
    })
    win = w
    w.setMenu(null)
    w.setVisibleOnAllWorkspaces(true)
    w.setOpacity(config.opacity)
    applyClickThrough(false)

    // showInactive：出现时不抢当前编辑器/聊天软件的焦点
    w.on('ready-to-show', () => w.showInactive())
    w.on('moved', saveBoundsSoon)
    w.on('resized', saveBoundsSoon)
    w.on('closed', () => {
        if (win === w) win = null
    })
    w.webContents.on('did-finish-load', pushSnapshot)
    // 右键菜单由渲染层通过 mini:popupMenu 触发，这样能知道是在哪一行上右键的

    if (process.env['ELECTRON_RENDERER_URL']) {
        w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/mini.html`)
    } else {
        w.loadFile(join(__dirname, '../renderer/mini.html'))
    }
}

function destroyMiniWindow(): void {
    if (win && !win.isDestroyed()) win.destroy()
    win = null
}

/** 当前实际显示的代码列表（未手动选择时就是默认列表），用于在小窗里直接调整。 */
function currentCodes(): string[] {
    return config.codes.length > 0 ? [...config.codes] : getWatchItems().map((i) => i.code)
}

function rowMenuItems(target: { code: string; name: string }): Electron.MenuItemConstructorOptions[] {
    const codes = currentCodes()
    const idx = codes.indexOf(target.code)
    const move = (to: number) => {
        codes.splice(idx, 1)
        codes.splice(to, 0, target.code)
        updateMiniConfig({ codes })
    }
    return [
        { label: `${target.name || target.code} 详情`, click: () => openMiniStock(target.code, target.name) },
        { label: '置顶', enabled: idx > 0, click: () => move(0) },
        { label: '上移', enabled: idx > 0, click: () => move(idx - 1) },
        { label: '下移', enabled: idx >= 0 && idx < codes.length - 1, click: () => move(idx + 1) },
        {
            label: '从小窗移除',
            enabled: idx >= 0,
            click: () => updateMiniConfig({ codes: codes.filter((c) => c !== target.code) }),
        },
        { type: 'separator' },
    ]
}

/** 渲染层右键时调用；在某一行上右键会多出该股票的排序/移除菜单。 */
export function popupMiniMenu(target?: { code: string; name: string }): void {
    if (!win || win.isDestroyed()) return
    buildContextMenu(target).popup({ window: win })
}

function buildContextMenu(target?: { code: string; name: string }): Menu {
    const opacities = [1, 0.9, 0.7, 0.5, 0.3]
    return Menu.buildFromTemplate([
        ...(target ? rowMenuItems(target) : []),
        { label: '选择盯盘股票…', click: () => hooks?.openRoute('/settings?section=mini') },
        { label: '打开主窗口', click: () => hooks?.openRoute('/') },
        { type: 'separator' },
        { label: '低调模式（灰度 + 代码）', type: 'checkbox', checked: config.stealth, click: () => updateMiniConfig({ stealth: !config.stealth }) },
        { label: '静默提醒（不弹系统通知）', type: 'checkbox', checked: config.silent, click: () => updateMiniConfig({ silent: !config.silent }) },
        { label: '鼠标穿透（仅顶部把手可操作）', type: 'checkbox', checked: config.clickThrough, click: () => updateMiniConfig({ clickThrough: !config.clickThrough }) },
        {
            label: '透明度',
            submenu: opacities.map((o) => ({
                label: `${Math.round(o * 100)}%`,
                type: 'radio' as const,
                checked: Math.abs(config.opacity - o) < 0.01,
                click: () => updateMiniConfig({ opacity: o }),
            })),
        },
        { label: '清空提醒', enabled: events.length > 0, click: () => clearMiniEvents() },
        { type: 'separator' },
        { label: config.bossKey ? `隐藏小窗（${config.bossKey} 呼出）` : '隐藏小窗', click: () => win?.hide() },
        { label: '关闭小屏盯盘', click: () => updateMiniConfig({ enabled: false }) },
    ])
}

// ─── 老板键 ────────────────────────────────────────────────────────────

/** 隐藏本应用所有可见窗口（主窗口、桌宠、小窗）；再按一次恢复刚才隐藏的那些。 */
function onBossKey(): void {
    if (bossHidden.length > 0) {
        for (const w of bossHidden) if (!w.isDestroyed()) w.showInactive()
        bossHidden = []
        return
    }
    const visible = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible())
    if (visible.length === 0) {
        // 什么都没显示时，把快捷键当作「呼出小窗」
        if (!win || win.isDestroyed()) createMiniWindow()
        else win.showInactive()
        return
    }
    for (const w of visible) w.hide()
    bossHidden = visible
}

/** 注册老板键；返回错误文案（null 表示成功或未配置）。 */
function registerBossKey(): string | null {
    if (registeredKey) globalShortcut.unregister(registeredKey)
    registeredKey = null
    const key = config.bossKey
    if (!config.enabled || !key) return null
    try {
        if (!globalShortcut.register(key, onBossKey)) return `快捷键 ${key} 已被其他应用占用，请换一个`
        registeredKey = key
        return null
    } catch {
        return `快捷键格式无效：${key}（示例：Alt+Shift+M、CommandOrControl+Shift+K）`
    }
}

// ─── 行情与提醒规则 ────────────────────────────────────────────────────

interface WatchItem {
    code: string
    name: string
    /** 持仓成本；非持仓为 null */
    cost: number | null
}

function getWatchItems(): WatchItem[] {
    // 持仓在前：同一只票既在持仓又在自选时，以持仓（带成本）为准
    const pool = new Map<string, WatchItem>()
    for (const h of getAllHoldings()) {
        if (h.quantity > 0 && !pool.has(h.code)) pool.set(h.code, { code: h.code, name: h.name, cost: h.avg_cost_price })
    }
    for (const w of getAllWatchlist() as Array<{ code: string; name: string }>) {
        if (!pool.has(w.code)) pool.set(w.code, { code: w.code, name: w.name, cost: null })
    }
    if (config.codes.length === 0) return [...pool.values()].slice(0, DEFAULT_ROWS)
    // 全网搜索加进来的票 / 已清仓或移出自选的票：名称用记住的 label，再回退到行情接口返回的名称
    return config.codes.map((code) => pool.get(code) ?? { code, name: config.labels[code] ?? '', cost: null })
}

function signed(n: number, digits = 2): string {
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
}

function stockRoute(code: string, name?: string): string {
    return `/stock/${code}${name ? `?name=${encodeURIComponent(name)}` : ''}`
}

/** 每个交易日只触发一次的规则（成本线、尾盘提醒）。 */
function fireOncePerDay(key: string): boolean {
    const today = shanghaiDateStr()
    const k = `${today}|${key}`
    if (firedToday.has(k)) return false
    if (firedToday.size > 500) {
        for (const old of firedToday) if (!old.startsWith(today)) firedToday.delete(old)
    }
    firedToday.add(k)
    return true
}

function evaluateRules(item: WatchItem, price: number, now: number): void {
    const history = histories.get(item.code) ?? []
    histories.set(item.code, pushSample(history, { t: now, price }, SURGE_WINDOW_MS + 60_000))

    if (config.surgePct > 0) {
        const s = surgePercent(history, now, SURGE_WINDOW_MS)
        if (s !== null && Math.abs(s) >= config.surgePct && surgeCooldown.allow(`${item.code}|${s > 0}`, now)) {
            emit({
                code: item.code,
                name: item.name,
                level: s > 0 ? 'up' : 'down',
                text: `${item.name} 5 分钟${s > 0 ? '急拉' : '急跌'} ${signed(s)}%，现价 ${price}`,
            })
        }
    }

    if (item.cost !== null) {
        const hit = checkCostLine(price, item.cost, config.takeProfitPct, config.stopLossPct)
        if (hit && fireOncePerDay(`${hit}|${item.code}`)) {
            const pct = ((price - item.cost) / item.cost) * 100
            emit({
                code: item.code,
                name: item.name,
                level: hit === 'take_profit' ? 'up' : 'down',
                text: `${item.name} ${hit === 'take_profit' ? '到达止盈线' : '跌破止损线'}，相对成本 ${signed(pct)}%，现价 ${price}`,
            })
        }
    }
}

async function poll(): Promise<void> {
    if (polling || !config.enabled) return
    const trading = isTradingTime()
    // 休市且小窗不可见时没必要请求；交易时段即使被老板键藏起来也要继续跑提醒规则
    if (!trading && !isVisible()) return
    polling = true
    try {
        const items = getWatchItems()
        const [quotes, indexes] = await Promise.all([
            items.length > 0 ? fetchBatchQuotes(items.map((i) => i.code)) : Promise.resolve([]),
            fetchIndexTicker().catch(() => [] as IndexTick[]),
        ])
        const qm = new Map(quotes.map((q) => [q.code, q]))
        const now = Date.now()
        const rows: MiniRow[] = []
        for (const item of items) {
            const q = qm.get(item.code)
            if (!q || !(q.price > 0)) continue
            rows.push({
                code: item.code,
                name: item.name || q.name,
                price: q.price,
                changePercent: q.changePercent,
                costPct: item.cost && item.cost > 0 ? ((q.price - item.cost) / item.cost) * 100 : null,
            })
            if (trading) evaluateRules(item, q.price, now)
        }
        state = {
            rows,
            index: indexes.find((i) => i.name === '上证指数') ?? indexes[0] ?? null,
            trading,
            updatedAt: now,
            error: items.length > 0 && rows.length === 0 ? '行情获取失败，稍后自动重试' : null,
        }
        if (trading && config.closeReminder && isTradingDay() && isCloseReminderTime(shanghaiNow()) && fireOncePerDay('close')) {
            emit({ level: 'info', text: '14:50 了，距收盘还有 10 分钟，要调仓的话抓紧' })
        }
    } catch (e) {
        console.error('[mini] poll error:', e)
        state = { ...state, trading, error: '行情获取失败，稍后自动重试' }
    } finally {
        polling = false
    }
    pushSnapshot()
}

function scheduleNext(): void {
    pollTimer = setTimeout(async () => {
        await poll()
        scheduleNext()
    }, isTradingTime() ? FAST_INTERVAL_MS : IDLE_INTERVAL_MS)
}

// ─── 提醒投递 ──────────────────────────────────────────────────────────

function pushEvent(e: Omit<MiniEvent, 'id' | 'at'>): MiniEvent {
    const ev: MiniEvent = { ...e, id: ++eventSeq, at: Date.now() }
    events = [ev, ...events].slice(0, MAX_EVENTS)
    if (win && !win.isDestroyed()) win.webContents.send('mini:event', ev)
    return ev
}

/** 小窗自身规则产生的提醒：总是进小窗；非静默模式下额外弹系统通知 + 桌宠气泡。 */
function emit(e: Omit<MiniEvent, 'id' | 'at'>): void {
    const ev = pushEvent(e)
    if (config.silent) return
    const n = new Notification({ title: '小屏盯盘提醒', body: ev.text })
    n.on('click', () => hooks?.openRoute(ev.code ? stockRoute(ev.code, ev.name) : '/'))
    n.show()
    hooks?.sendToPet(`👀 ${ev.text}`)
}

/**
 * 供价格提醒、技术信号等模块调用：小屏盯盘开启且为静默模式时，由小窗接管提醒。
 * 返回 true 表示已接管，调用方不要再弹系统通知 / 桌宠气泡。
 */
export function routeToMini(e: { code?: string; name?: string; text: string; level?: MiniEvent['level'] }): boolean {
    if (!config.enabled || !config.silent) return false
    pushEvent({ ...e, level: e.level ?? 'info' })
    return true
}

export function clearMiniEvents(): void {
    events = []
    pushSnapshot()
}

export function getMiniSnapshot(): MiniSnapshot {
    return { ...state, events, config }
}

function pushSnapshot(): void {
    if (win && !win.isDestroyed()) win.webContents.send('mini:snapshot', getMiniSnapshot())
}

export function openMiniStock(code: string, name?: string): void {
    hooks?.openRoute(stockRoute(code, name))
}

// ─── 对外入口 ──────────────────────────────────────────────────────────

/** 合并更新配置并立即生效；返回最新配置和老板键注册错误（如有）。 */
export function updateMiniConfig(patch: Partial<MiniConfig>): { config: MiniConfig; error: string | null } {
    const prev = config
    config = normalizeMiniConfig({ ...config, ...patch })
    setSetting(CONFIG_KEY, JSON.stringify(config))

    if (!config.enabled) {
        destroyMiniWindow()
        histories.clear()
        surgeCooldown.clear()
    } else if (!win || win.isDestroyed()) {
        createMiniWindow()
    } else {
        win.setOpacity(config.opacity)
        applyClickThrough(false)
        if (config.codes.length !== prev.codes.length) {
            // 盯的股票数变了，高度跟着行数走，宽度保留用户拖出来的尺寸
            const [width] = win.getSize()
            win.setSize(width, defaultHeight())
        }
    }
    const error = registerBossKey()
    pushSnapshot()
    const codesChanged = config.codes.join(',') !== prev.codes.join(',')
    if (config.enabled && (!prev.enabled || codesChanged)) void poll()
    return { config, error }
}

/** 托盘 / 设置页使用：小屏盯盘未开启时开启；已开启时切换显示与隐藏。 */
export function toggleMiniWindow(): void {
    if (!config.enabled) {
        updateMiniConfig({ enabled: true })
        return
    }
    if (!win || win.isDestroyed()) createMiniWindow()
    else if (win.isVisible()) win.hide()
    else win.showInactive()
}

export function startMiniTicker(h: MiniHooks): void {
    hooks = h
    config = loadConfig()
    if (config.enabled) createMiniWindow()
    const error = registerBossKey()
    if (error) console.warn('[mini]', error)
    void poll()
    if (!pollTimer) scheduleNext()
}

export function stopMiniTicker(): void {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    globalShortcut.unregisterAll()
}
