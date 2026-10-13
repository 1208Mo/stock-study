import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHoldingsStore } from '../stores/holdingsStore'
import { stockRoute } from '../utils/routes'
import type { WatchItem } from '../types'

interface Item {
    id: string
    group: '股票' | '页面' | '操作'
    title: string
    subtitle?: string
    badge?: string
    run: () => void
}

const PAGES: Array<{ path: string; title: string; keywords: string }> = [
    { path: '/', title: '市场总览', keywords: 'dashboard home sczl 首页 大盘' },
    { path: '/portfolio', title: '持仓管理', keywords: 'portfolio cc 持仓 收益' },
    { path: '/watchlist', title: '观察列表', keywords: 'watchlist gc 自选' },
    { path: '/radar', title: '板块雷达', keywords: 'radar bk 板块 资金' },
    { path: '/chat', title: '小墨鱼 AI', keywords: 'ai chat xmy 对话 决策 计划' },
    { path: '/alerts', title: '提醒中心', keywords: 'alerts tx 提醒 通知' },
    { path: '/settings', title: '设置', keywords: 'settings sz 设置 主题 模型' },
]

export const OPEN_COMMAND_PALETTE = 'open-command-palette'

function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false
    return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/**
 * 全局命令面板：⌘K / Ctrl+K 打开；不在输入框里时直接敲数字或字母也会打开（键盘精灵）。
 */
export default function CommandPalette() {
    const navigate = useNavigate()
    const holdings = useHoldingsStore((s) => s.holdings)
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [active, setActive] = useState(0)
    const [remote, setRemote] = useState<Array<{ code: string; name: string }>>([])
    const [watchlist, setWatchlist] = useState<WatchItem[]>([])
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                setOpen((v) => !v)
                setQuery('')
                return
            }
            if (open || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
            if (document.querySelector('.modal-overlay')) return
            if (/^[0-9a-zA-Z]$/.test(e.key)) {
                e.preventDefault()
                setQuery(e.key)
                setOpen(true)
            }
        }
        const onOpen = () => {
            setQuery('')
            setOpen(true)
        }
        window.addEventListener('keydown', onKey)
        window.addEventListener(OPEN_COMMAND_PALETTE, onOpen)
        return () => {
            window.removeEventListener('keydown', onKey)
            window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen)
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        setActive(0)
        setTimeout(() => inputRef.current?.focus(), 0)
        window.api.watchlist.getAll().then(setWatchlist).catch(() => {})
    }, [open])

    useEffect(() => {
        const q = query.trim()
        if (!open || !q) {
            setRemote([])
            return
        }
        const timer = setTimeout(() => {
            window.api.market
                .search(q)
                .then((r) => setRemote(r.slice(0, 8)))
                .catch(() => setRemote([]))
        }, 200)
        return () => clearTimeout(timer)
    }, [query, open])

    const close = () => {
        setOpen(false)
        setQuery('')
    }

    const items = useMemo<Item[]>(() => {
        const q = query.trim().toLowerCase()
        const out: Item[] = []
        const seen = new Set<string>()
        const pushStock = (code: string, name: string, badge?: string) => {
            if (seen.has(code)) return
            seen.add(code)
            out.push({
                id: `s-${code}`,
                group: '股票',
                title: name,
                subtitle: code,
                badge,
                run: () => navigate(stockRoute(code, name)),
            })
        }
        const match = (code: string, name: string) => !q || code.includes(q) || name.toLowerCase().includes(q)

        holdings.filter((h) => match(h.code, h.name)).slice(0, q ? 5 : 4).forEach((h) => pushStock(h.code, h.name, '持仓'))
        watchlist.filter((w) => match(w.code, w.name)).slice(0, q ? 5 : 3).forEach((w) => pushStock(w.code, w.name, '自选'))
        if (q) remote.forEach((r) => pushStock(r.code, r.name))

        PAGES.filter((p) => !q || p.title.includes(q) || p.keywords.includes(q)).forEach((p) =>
            out.push({ id: `p-${p.path}`, group: '页面', title: p.title, run: () => navigate(p.path) })
        )

        if (q && !/^\d+$/.test(q)) {
            out.push({
                id: 'a-ask',
                group: '操作',
                title: `问小墨鱼：「${query.trim()}」`,
                run: () => navigate(`/chat?q=${encodeURIComponent(query.trim())}`),
            })
        }
        return out
    }, [query, holdings, watchlist, remote, navigate])

    useEffect(() => {
        if (active >= items.length) setActive(Math.max(0, items.length - 1))
    }, [items.length, active])

    useEffect(() => {
        listRef.current?.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' })
    }, [active])

    if (!open) return null

    const onInputKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') close()
        else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, items.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
        } else if (e.key === 'Enter' && items[active]) {
            items[active].run()
            close()
        }
    }

    let lastGroup = ''
    return (
        <div className="cmdk-overlay" onClick={close}>
            <div className="cmdk" onClick={(e) => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    className="cmdk-input"
                    placeholder="搜索股票代码/名称/拼音，或跳转页面、问小墨鱼…"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value)
                        setActive(0)
                    }}
                    onKeyDown={onInputKey}
                />
                <div className="cmdk-list" ref={listRef}>
                    {items.length === 0 && <div className="cmdk-empty">没有匹配结果</div>}
                    {items.map((it, i) => {
                        const header = it.group !== lastGroup ? it.group : null
                        lastGroup = it.group
                        return (
                            <div key={it.id}>
                                {header && <div className="cmdk-group">{header}</div>}
                                <button
                                    className={`cmdk-item ${i === active ? 'active' : ''}`}
                                    onMouseMove={() => setActive(i)}
                                    onClick={() => {
                                        it.run()
                                        close()
                                    }}
                                >
                                    <span className="cmdk-title">{it.title}</span>
                                    {it.subtitle && <span className="cmdk-sub">{it.subtitle}</span>}
                                    {it.badge && <span className="alert-badge">{it.badge}</span>}
                                </button>
                            </div>
                        )
                    })}
                </div>
                <div className="cmdk-footer">
                    <span>↑↓ 选择</span>
                    <span>↵ 打开</span>
                    <span>Esc 关闭</span>
                    <span>⌘K 随时唤起</span>
                </div>
            </div>
        </div>
    )
}
