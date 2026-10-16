import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Holding, WatchItem } from '../types'

/** 与主进程 miniTicker.MAX_CODES 保持一致 */
const MAX_CODES = 10
const SEARCH_DEBOUNCE_MS = 300
/** 指数用带交易所前缀的代码保存（sh000001），避免和同号个股冲突 */
const INDEX_CODE = /^(sh|sz)(\d{6})$/i

interface PoolItem {
    code: string
    name: string
    held: boolean
    watched: boolean
}

interface RemoteItem {
    /** 存进配置、用于拉行情的代码（指数带前缀） */
    code: string
    name: string
    kind: 'stock' | 'index' | 'fund'
}

type Filter = 'all' | 'held' | 'watched' | 'remote'

interface Props {
    codes: string[]
    labels: Record<string, string>
    onChange: (codes: string[], labels: Record<string, string>) => void
}

function displayCode(code: string): string {
    return code.match(INDEX_CODE)?.[2] ?? code
}

/**
 * 小屏盯盘的选股器：从持仓 / 自选里勾选，或全网搜索 A 股、指数、ETF 加入；已选列表可排序、移除。
 * 顺序即小窗里的显示顺序。
 */
export default function MiniStockPicker({ codes, labels, onChange }: Props) {
    const [pool, setPool] = useState<PoolItem[]>([])
    const [filter, setFilter] = useState<Filter>('all')
    const [keyword, setKeyword] = useState('')
    const [remote, setRemote] = useState<RemoteItem[]>([])
    const [searching, setSearching] = useState(false)
    const [searchError, setSearchError] = useState(false)
    const searchSeq = useRef(0)

    useEffect(() => {
        Promise.all([window.api.holdings.getAll(), window.api.watchlist.getAll()]).then(
            ([holdings, watchlist]: [Holding[], WatchItem[]]) => {
                const map = new Map<string, PoolItem>()
                for (const h of holdings) {
                    if (h.quantity > 0) map.set(h.code, { code: h.code, name: h.name, held: true, watched: false })
                }
                for (const w of watchlist) {
                    const hit = map.get(w.code)
                    if (hit) hit.watched = true
                    else map.set(w.code, { code: w.code, name: w.name, held: false, watched: true })
                }
                setPool([...map.values()])
            }
        )
    }, [])

    // 全网搜索：防抖 + 丢弃过期响应，只保留沪深市场（港美股拉不到 A 股口径的行情）
    const k = keyword.trim()
    useEffect(() => {
        const seq = ++searchSeq.current
        setSearchError(false)
        if (!k) {
            setRemote([])
            setSearching(false)
            return
        }
        setSearching(true)
        const timer = setTimeout(async () => {
            try {
                const list = await window.api.market.search(k)
                if (seq !== searchSeq.current) return
                setRemote(
                    list
                        .filter((i) => i.market === '0' || i.market === '1')
                        .map((i) => ({
                            code: i.quoteCode || i.code,
                            name: i.name,
                            kind: i.type === 'Index' ? 'index' : i.type === 'Fund' ? 'fund' : 'stock',
                        }))
                )
            } catch {
                if (seq === searchSeq.current) setSearchError(true)
            } finally {
                if (seq === searchSeq.current) setSearching(false)
            }
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [k])

    const byCode = useMemo(() => new Map(pool.map((p) => [p.code, p])), [pool])
    const selected = new Set(codes)
    const full = codes.length >= MAX_CODES

    const localMatches =
        filter === 'remote'
            ? []
            : pool.filter((p) => {
                  if (filter === 'held' && !p.held) return false
                  if (filter === 'watched' && !p.watched) return false
                  return !k || p.code.includes(k) || p.name.includes(k)
              })
    // 已在持仓/自选里的就不在全网结果里重复出现
    const remoteMatches = filter === 'all' || filter === 'remote' ? remote.filter((r) => !byCode.has(r.code)) : []

    const add = (code: string, name: string) => {
        if (selected.has(code) || full) return
        // 不在持仓/自选里的票要记住名称，否则重启后小窗和这里只能显示代码
        onChange([...codes, code], byCode.has(code) ? labels : { ...labels, [code]: name })
    }
    const remove = (code: string) => onChange(codes.filter((c) => c !== code), labels)
    const toggle = (code: string, name: string) => (selected.has(code) ? remove(code) : add(code, name))
    const move = (idx: number, delta: number) => {
        const next = [...codes]
        const [item] = next.splice(idx, 1)
        next.splice(idx + delta, 0, item)
        onChange(next, labels)
    }

    const poolTags = (p: PoolItem) => (
        <>
            {p.held && <span className="mini-pick-tag held">持仓</span>}
            {p.watched && <span className="mini-pick-tag">自选</span>}
        </>
    )
    const kindTag = (kind: RemoteItem['kind']) => (
        <span className="mini-pick-tag">{kind === 'index' ? '指数' : kind === 'fund' ? '基金' : '全网'}</span>
    )
    const row = (code: string, name: string, tags: ReactNode) => {
        const checked = selected.has(code)
        return (
            <label
                key={code}
                className={`mini-pick-item selectable ${!checked && full ? 'disabled' : ''}`}
                title={!checked && full ? `最多盯 ${MAX_CODES} 只` : undefined}
            >
                <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(code, name)} />
                <span className="mini-pick-name">{name}</span>
                <span className="mini-pick-code">{displayCode(code)}</span>
                {tags}
            </label>
        )
    }

    return (
        <div className="mini-pick">
            <div className="mini-pick-col">
                <div className="mini-pick-head">
                    <span>
                        已选 {codes.length}/{MAX_CODES}
                    </span>
                    {codes.length > 0 && (
                        <button className="btn-small" onClick={() => onChange([], {})}>
                            清空
                        </button>
                    )}
                </div>
                <div className="mini-pick-list">
                    {codes.length === 0 && (
                        <div className="mini-pick-empty">未选择时，小窗默认显示前 5 只持仓（不足用自选补齐）</div>
                    )}
                    {codes.map((code, i) => {
                        const p = byCode.get(code)
                        return (
                            <div className="mini-pick-item" key={code}>
                                <span className="mini-pick-order">{i + 1}</span>
                                <span className="mini-pick-name">{p?.name ?? labels[code] ?? code}</span>
                                <span className="mini-pick-code">{displayCode(code)}</span>
                                {p ? poolTags(p) : kindTag(INDEX_CODE.test(code) ? 'index' : 'stock')}
                                <span className="mini-pick-actions">
                                    <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">↑</button>
                                    <button disabled={i === codes.length - 1} onClick={() => move(i, 1)} aria-label="下移">↓</button>
                                    <button onClick={() => remove(code)} aria-label="移除">✕</button>
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>
            <div className="mini-pick-col">
                <div className="mini-pick-head">
                    {(
                        [
                            ['all', '全部'],
                            ['held', '持仓'],
                            ['watched', '自选'],
                            ['remote', '全网'],
                        ] as const
                    ).map(([key, text]) => (
                        <button
                            key={key}
                            className={`mini-pick-tab ${filter === key ? 'active' : ''}`}
                            onClick={() => setFilter(key)}
                        >
                            {text}
                        </button>
                    ))}
                    <input
                        className="input mini-pick-search"
                        placeholder="代码 / 名称 / 拼音，可搜全网个股、指数、ETF"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                    />
                </div>
                <div className="mini-pick-list">
                    {localMatches.map((p) => row(p.code, p.name, poolTags(p)))}
                    {filter !== 'remote' && pool.length === 0 && !k && (
                        <div className="mini-pick-empty">还没有持仓或自选，可以直接搜索全网股票</div>
                    )}
                    {(filter === 'all' || filter === 'remote') && k && (
                        <>
                            {filter === 'all' && remoteMatches.length > 0 && (
                                <div className="mini-pick-section">全网结果</div>
                            )}
                            {remoteMatches.map((r) => row(r.code, r.name, kindTag(r.kind)))}
                            {searching && remoteMatches.length === 0 && <div className="mini-pick-empty">搜索中…</div>}
                            {searchError && <div className="mini-pick-empty">全网搜索失败，检查网络后重试</div>}
                        </>
                    )}
                    {k && !searching && !searchError && localMatches.length === 0 && remoteMatches.length === 0 && (
                        <div className="mini-pick-empty">没有匹配的股票</div>
                    )}
                    {filter === 'remote' && !k && (
                        <div className="mini-pick-empty">输入代码、名称或拼音首字母，搜索沪深个股、指数、ETF</div>
                    )}
                    {(filter === 'held' || filter === 'watched') && !k && localMatches.length === 0 && pool.length > 0 && (
                        <div className="mini-pick-empty">这里还没有股票</div>
                    )}
                </div>
            </div>
        </div>
    )
}
