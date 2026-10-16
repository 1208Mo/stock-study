import { useEffect, useMemo, useRef, useState } from 'react'
import type { MiniEvent, MiniRow, MiniSnapshot } from '../types'

/** 被提醒命中的行闪烁多久 */
const FLASH_MS = 8_000
/** 底部提醒条展示最新提醒多久，之后退回到「更新时间」 */
const BANNER_MS = 60_000

const EMOJI_RE = /\p{Extended_Pictographic}\uFE0F?\s*/gu

function signed(n: number, digits = 2): string {
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
}

function hhmm(ts: number): string {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function tone(n: number): 'up' | 'down' | 'flat' {
    return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

export default function Mini() {
    const [snap, setSnap] = useState<MiniSnapshot | null>(null)
    const [flash, setFlash] = useState<Record<string, number>>({})
    const [showEvents, setShowEvents] = useState(false)
    const [now, setNow] = useState(() => Date.now())
    const interactiveRef = useRef(false)

    useEffect(() => {
        window.api.mini.snapshot().then(setSnap)
        const offSnap = window.api.mini.onSnapshot(setSnap)
        const offEvent = window.api.mini.onEvent((ev: MiniEvent) => {
            setSnap((s) => (s ? { ...s, events: [ev, ...s.events].slice(0, 20) } : s))
            if (ev.code) setFlash((f) => ({ ...f, [ev.code as string]: ev.at + FLASH_MS }))
        })
        const timer = setInterval(() => setNow(Date.now()), 1_000)
        return () => {
            offSnap()
            offEvent()
            clearInterval(timer)
        }
    }, [])

    const config = snap?.config
    const stealth = !!config?.stealth
    const clean = (text: string) => (stealth ? text.replace(EMOJI_RE, '') : text)
    const latest = snap?.events[0]
    const bannerEvent = latest && now - latest.at < BANNER_MS ? latest : null

    // 鼠标穿透模式：只有鼠标在顶部把手上时窗口才接收点击
    const setInteractive = (v: boolean) => {
        if (!config?.clickThrough || interactiveRef.current === v) return
        interactiveRef.current = v
        window.api.mini.setInteractive(v)
    }

    // 鼠标直接从把手移出窗口时 mouseleave 不一定可靠，离开文档时再兜底恢复穿透
    useEffect(() => {
        const onLeave = () => setInteractive(false)
        document.documentElement.addEventListener('mouseleave', onLeave)
        return () => document.documentElement.removeEventListener('mouseleave', onLeave)
    })

    const rows = snap?.rows ?? []
    const label = (r: MiniRow) => (stealth ? r.code : r.name)
    const statusText = useMemo(() => {
        if (!snap) return '加载中'
        if (snap.error) return snap.error
        if (!snap.updatedAt) return '等待行情'
        return `${snap.trading ? '' : '休市 · '}${hhmm(snap.updatedAt)} 更新`
    }, [snap])

    return (
        <div
            className={`mini ${stealth ? 'stealth' : ''}`}
            onContextMenu={(e) => {
                e.preventDefault()
                window.api.mini.popupMenu()
            }}
        >
            <div
                className="mini-handle"
                onMouseEnter={() => setInteractive(true)}
                onMouseLeave={() => setInteractive(false)}
                title="拖动移动 · ⋯ 打开菜单"
            >
                {snap?.index ? (
                    <span className={`mini-index ${tone(snap.index.changePercent)}`}>
                        {stealth ? 'SH' : '上证'} {snap.index.price.toFixed(2)} {signed(snap.index.changePercent)}%
                    </span>
                ) : (
                    <span className="mini-index flat">StockMind</span>
                )}
                <span className={`mini-dot ${snap?.trading ? 'live' : ''}`} />
                {/* 拖动区域在部分平台上收不到鼠标事件，菜单入口和穿透模式的「解锁」都放在这个非拖动按钮上 */}
                <button
                    className="mini-menu-btn"
                    onMouseEnter={() => setInteractive(true)}
                    onClick={() => window.api.mini.popupMenu()}
                    aria-label="小窗菜单"
                >
                    ⋯
                </button>
            </div>

            {showEvents ? (
                <div className="mini-list" onMouseEnter={() => setInteractive(false)}>
                    {(snap?.events ?? []).length === 0 && <div className="mini-empty">暂无提醒</div>}
                    {(snap?.events ?? []).map((ev) => (
                        <div
                            key={ev.id}
                            className={`mini-event ${ev.level}`}
                            onDoubleClick={() => ev.code && window.api.mini.openStock(ev.code, ev.name)}
                            title={ev.text}
                        >
                            <span className="mini-time">{hhmm(ev.at)}</span>
                            {clean(ev.text)}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mini-list" onMouseEnter={() => setInteractive(false)}>
                    {rows.length === 0 && snap && !snap.error && (
                        <div className="mini-empty">点右上角 ⋯ →「选择盯盘股票…」，从持仓 / 自选里挑</div>
                    )}
                    {rows.map((r) => (
                        <div
                            key={r.code}
                            className={`mini-row ${(flash[r.code] ?? 0) > now ? 'flash' : ''}`}
                            onDoubleClick={() => window.api.mini.openStock(r.code, r.name)}
                            onContextMenu={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                window.api.mini.popupMenu({ code: r.code, name: r.name })
                            }}
                            title={
                                r.costPct !== null
                                    ? `${r.name} 相对成本 ${signed(r.costPct)}% · 双击详情 · 右键排序/移除`
                                    : `${r.name} · 双击详情 · 右键排序/移除`
                            }
                        >
                            <span className="mini-name">{label(r)}</span>
                            <span className="mini-price">{r.price.toFixed(2)}</span>
                            <span className={`mini-pct ${tone(r.changePercent)}`}>{signed(r.changePercent)}%</span>
                        </div>
                    ))}
                </div>
            )}

            <div
                onMouseEnter={() => setInteractive(false)}
                className={`mini-footer ${bannerEvent ? `has-event ${bannerEvent.level}` : ''}`}
                onClick={() => setShowEvents((v) => !v)}
                title={showEvents ? '点击返回行情' : '点击查看提醒列表'}
            >
                <span className="mini-footer-text">
                    {showEvents ? '← 返回行情' : bannerEvent ? clean(bannerEvent.text) : statusText}
                </span>
                {!showEvents && (snap?.events.length ?? 0) > 0 && (
                    <span className="mini-badge">{snap?.events.length}</span>
                )}
            </div>
        </div>
    )
}
