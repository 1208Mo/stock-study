/**
 * 应用内自动更新（electron-updater，发布源为 GitHub Releases）
 *
 * - 仅打包后的应用生效；开发模式下直接返回 unsupported。
 * - Windows（NSIS）：检测到新版本后可在应用内下载，下载完成重启即安装。
 * - macOS：当前安装包未做代码签名，Squirrel.Mac 拒绝安装未签名的更新包，
 *   所以只检测版本，发现新版本后引导用户打开 Releases 页面手动下载 dmg。
 * - 默认启动 15 秒后检查一次，之后每 6 小时检查一次，可在设置里关闭。
 */

import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { getSetting } from '../db'

const RELEASES_URL = 'https://github.com/1208Mo/stock-study/releases/latest'
const CHECK_INTERVAL_MS = 6 * 3600_000

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported'

export interface UpdateState {
    status: UpdateStatus
    currentVersion: string
    latestVersion: string | null
    releaseNotes: string | null
    /** 0~100 */
    progress: number | null
    error: string | null
    /** 能否在应用内下载安装（macOS 未签名时为 false，只能去网页下载） */
    canAutoInstall: boolean
    checkedAt: number | null
}

const canAutoInstall = process.platform === 'win32'

let state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    latestVersion: null,
    releaseNotes: null,
    progress: null,
    error: null,
    canAutoInstall,
    checkedAt: null,
}

function setState(patch: Partial<UpdateState>): void {
    state = { ...state, ...patch }
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('updater:state', state)
    }
}

function notesText(info: UpdateInfo): string | null {
    const n = info.releaseNotes
    if (!n) return null
    const raw = typeof n === 'string' ? n : n.map((x) => x.note ?? '').join('\n')
    // GitHub 返回的是 HTML，去掉标签只留文字
    return raw.replace(/<[^>]+>/g, '').trim() || null
}

let wired = false

function wire(): void {
    if (wired) return
    wired = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = canAutoInstall
    autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info: UpdateInfo) =>
        setState({ status: 'available', latestVersion: info.version, releaseNotes: notesText(info), checkedAt: Date.now() })
    )
    autoUpdater.on('update-not-available', (info: UpdateInfo) =>
        setState({ status: 'not-available', latestVersion: info.version, checkedAt: Date.now() })
    )
    autoUpdater.on('download-progress', (p: ProgressInfo) => setState({ status: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', () => setState({ status: 'downloaded', progress: 100 }))
    autoUpdater.on('error', (e: Error) => setState({ status: 'error', error: friendlyError(e), checkedAt: Date.now() }))
}

function friendlyError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e)
    if (/404|Cannot find latest|No published versions/i.test(msg)) return '还没有发布过可用的新版本'
    if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket/i.test(msg)) return '无法连接 GitHub，请检查网络或代理'
    return msg.split('\n')[0].slice(0, 200)
}

export function getUpdateState(): UpdateState {
    return state
}

export async function checkForUpdates(): Promise<UpdateState> {
    if (!app.isPackaged) {
        setState({ status: 'unsupported', error: '开发模式下不检查更新，打包安装后生效' })
        return state
    }
    wire()
    try {
        await autoUpdater.checkForUpdates()
    } catch (e) {
        setState({ status: 'error', error: friendlyError(e), checkedAt: Date.now() })
    }
    return state
}

export async function downloadUpdate(): Promise<UpdateState> {
    if (!canAutoInstall) {
        await shell.openExternal(RELEASES_URL)
        return state
    }
    try {
        setState({ status: 'downloading', progress: 0 })
        await autoUpdater.downloadUpdate()
    } catch (e) {
        setState({ status: 'error', error: friendlyError(e) })
    }
    return state
}

export function installUpdate(): void {
    if (state.status === 'downloaded') autoUpdater.quitAndInstall()
}

export function openReleasePage(): Promise<void> {
    return shell.openExternal(RELEASES_URL)
}

export function startAutoUpdateCheck(): void {
    if (!app.isPackaged) return
    const tick = () => {
        if (getSetting('auto_check_update') !== '0') void checkForUpdates()
    }
    setTimeout(tick, 15_000)
    setInterval(tick, CHECK_INTERVAL_MS)
}
