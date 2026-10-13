import { useEffect, useState } from 'react'
import type { UpdateState } from '../types'

const STATUS_TEXT: Record<UpdateState['status'], string> = {
    idle: '尚未检查',
    checking: '正在检查…',
    available: '发现新版本',
    'not-available': '已是最新版本',
    downloading: '正在下载…',
    downloaded: '下载完成，重启即可安装',
    error: '检查失败',
    unsupported: '当前环境不支持',
}

/** 设置页「版本与更新」区块 */
export default function UpdateSection() {
    const [state, setState] = useState<UpdateState | null>(null)
    const [autoCheck, setAutoCheck] = useState(true)

    useEffect(() => {
        window.api.updater.getState().then(setState)
        window.api.settings.get('auto_check_update').then((v) => setAutoCheck(v !== '0'))
        return window.api.updater.onState(setState)
    }, [])

    if (!state) return null
    const busy = state.status === 'checking' || state.status === 'downloading'

    return (
        <section className="settings-section">
            <h2>版本与更新</h2>
            <div className="source-row">
                <span>
                    当前版本 <strong>v{state.currentVersion}</strong>
                </span>
                <span className="dash-muted">
                    {STATUS_TEXT[state.status]}
                    {state.latestVersion && state.status === 'available' && `：v${state.latestVersion}`}
                    {state.status === 'downloading' && state.progress !== null && ` ${state.progress}%`}
                    {state.error && `（${state.error}）`}
                </span>
                <button className="btn-small" disabled={busy} onClick={() => window.api.updater.check().then(setState)}>
                    检查更新
                </button>
                {state.status === 'available' && (
                    <button className="btn-small" onClick={() => window.api.updater.download()}>
                        {state.canAutoInstall ? '下载更新' : '前往下载页'}
                    </button>
                )}
                {state.status === 'downloaded' && (
                    <button className="btn-small" onClick={() => window.api.updater.install()}>
                        重启并安装
                    </button>
                )}
                <button className="btn-small" onClick={() => window.api.updater.openReleases()}>
                    更新日志
                </button>
            </div>
            {state.status === 'downloading' && state.progress !== null && (
                <div className="screener-progress-bar" style={{ marginTop: 8 }}>
                    <div style={{ width: `${state.progress}%` }} />
                </div>
            )}
            {state.releaseNotes && state.status === 'available' && <pre className="update-notes">{state.releaseNotes}</pre>}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 8 }}>
                <input
                    type="checkbox"
                    checked={autoCheck}
                    onChange={async (e) => {
                        setAutoCheck(e.target.checked)
                        await window.api.settings.set('auto_check_update', e.target.checked ? '1' : '0')
                    }}
                />
                <span>启动时自动检查更新（之后每 6 小时检查一次）</span>
            </label>
            <p className="settings-note">
                新版本发布在 GitHub Releases。Windows 可在应用内下载并重启安装；macOS 安装包未做代码签名，
                系统不允许静默替换，发现新版本后会引导你到下载页手动下载 dmg。
            </p>
        </section>
    )
}
