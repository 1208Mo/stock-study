import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWatchlistStore } from '../stores/watchlistStore'
import type { WatchItem } from '../types'

// 从文本中解析股票代码
function parseCodesFromText(text: string): string[] {
    const seen = new Set<string>()
    const results: string[] = []
    for (const line of text.split(/[\n;；,，]/)) {
        const m = line.match(/\b(\d{6})\b/)
        if (m && !seen.has(m[1])) {
            seen.add(m[1])
            results.push(m[1])
        }
    }
    return results
}

export default function Watchlist() {
    const {
        items,
        quotes,
        loading,
        fetchWatchlist,
        addItem,
        removeItem,
        search,
        groups,
        itemGroups,
        setItemGroup,
        updateSector,
    } = useWatchlistStore()
    const [keyword, setKeyword] = useState('')
    const [searchResults, setSearchResults] = useState<{ code: string; name: string }[]>([])
    const [searching, setSearching] = useState(false)
    const [searchDone, setSearchDone] = useState(false)
    const navigate = useNavigate()

    // 批量导入
    const [batchText, setBatchText] = useState('')
    const [batchParsed, setBatchParsed] = useState<string[]>([])
    const [batchImporting, setBatchImporting] = useState(false)
    const [batchMsg, setBatchMsg] = useState('')

    // 分组管理
    const [activeGroup, setActiveGroup] = useState<string>('')
    const [sectorRefreshing, setSectorRefreshing] = useState(false)
    // 首次加载后自动补全缺失板块的自选股，无需用户手动点"刷新板块"
    const autoFillSectorRef = useRef(false)
    const [sectorFilter, setSectorFilter] = useState<string>('全部')

    // 批量刷新所有自选股的板块-细分板块（直接调 IPC，最后统一 reload）
    async function handleRefreshSectors() {
        if (sectorRefreshing || items.length === 0) return
        setSectorRefreshing(true)
        try {
            for (let i = 0; i < items.length; i += 4) {
                const batch = items.slice(i, i + 4)
                await Promise.all(
                    batch.map(async (it) => {
                        try {
                            const info = await window.api.market.getSectorInfo(it.code)
                            if (info.sector || info.subSector) {
                                await window.api.watchlist.updateSector(it.id, info.sector, info.subSector)
                            }
                        } catch {
                            // ignore single failure
                        }
                    })
                )
            }
            await fetchWatchlist()
        } finally {
            setSectorRefreshing(false)
        }
    }

    useEffect(() => {
        fetchWatchlist()
        // 每5秒刷新一次行情
        const timer = setInterval(() => {
            useWatchlistStore.getState().refreshWatchlistQuotes()
        }, 5000)
        return () => clearInterval(timer)
    }, [])

    // 自动补全缺失板块（sector 与 sub_sector 均为空）的自选股，首次加载静默执行一次
    useEffect(() => {
        if (autoFillSectorRef.current) return
        if (loading || items.length === 0) return
        const missing = items.filter((it) => !it.sector && !it.sub_sector)
        if (missing.length === 0) return
        autoFillSectorRef.current = true
        ;(async () => {
            setSectorRefreshing(true)
            try {
                for (let i = 0; i < missing.length; i += 4) {
                    const batch = missing.slice(i, i + 4)
                    await Promise.all(
                        batch.map(async (it) => {
                            try {
                                const info = await window.api.market.getSectorInfo(it.code)
                                if (info.sector || info.subSector) {
                                    await window.api.watchlist.updateSector(it.id, info.sector, info.subSector)
                                }
                            } catch {
                                // ignore single failure
                            }
                        })
                    )
                }
                await fetchWatchlist()
            } finally {
                setSectorRefreshing(false)
            }
        })()
    }, [items, loading])

    async function handleSearch() {
        if (!keyword.trim()) return
        setSearching(true)
        setSearchDone(false)
        try {
            const results = await search(keyword)
            setSearchResults(results)
            setSearchDone(true)
        } catch (e) {
            console.error(e)
        } finally {
            setSearching(false)
        }
    }

    async function handleAdd(code: string, name: string) {
        // 添加自选股时自动获取板块信息（失败留空）
        let sector = ''
        let subSector = ''
        try {
            const info = await window.api.market.getSectorInfo(code)
            sector = info.sector || ''
            subSector = info.subSector || ''
        } catch {
            // 接口失败留空
        }
        await addItem(code, name, undefined, sector, subSector)
        setSearchResults([])
        setKeyword('')
    }

    // 点击板块标签编辑（自选股无编辑 modal，用 prompt 轻量实现）
    async function handleEditSector(item: WatchItem) {
        const newSector = window.prompt('请输入板块（如：科技）', item.sector ?? '')
        if (newSector === null) return
        const newSubSector = window.prompt('请输入细分板块（如：半导体）', item.sub_sector ?? '')
        if (newSubSector === null) return
        await updateSector(item.id, newSector.trim(), newSubSector.trim())
    }

    function handleBatchTextChange(text: string) {
        setBatchText(text)
        setBatchParsed(parseCodesFromText(text))
        setBatchMsg('')
    }

    async function handleBatchImport() {
        if (batchParsed.length === 0) return
        setBatchImporting(true)
        setBatchMsg('')
        let ok = 0,
            fail = 0
        for (const code of batchParsed) {
            try {
                const results = await window.api.market.search(code).catch(() => [])
                const name = results[0]?.name || code
                // 批量导入也尝试获取板块（失败留空）
                let sector = ''
                let subSector = ''
                try {
                    const info = await window.api.market.getSectorInfo(code)
                    sector = info.sector || ''
                    subSector = info.subSector || ''
                } catch {
                    // 接口失败留空
                }
                await addItem(code, name, undefined, sector, subSector)
                ok++
            } catch {
                fail++
            }
        }
        setBatchMsg(`导入完成：${ok} 个成功，${fail} 个已存在或失败。`)
        setBatchImporting(false)
        setBatchText('')
        setBatchParsed([])
    }

    // 按板块筛选（叠加在自定义分组筛选之上）
    const sectorKey = (s?: string) => (s && s.trim()) || '未分类'
    const sectorCounts = useMemo(() => {
        const map = new Map<string, number>()
        for (const it of items) {
            const k = sectorKey(it.sector)
            map.set(k, (map.get(k) ?? 0) + 1)
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1])
    }, [items])
    const groupFiltered =
        activeGroup === ''
            ? items
            : items.filter((item) => itemGroups.get(item.id) === activeGroup)
    const visibleItems =
        sectorFilter === '全部'
            ? groupFiltered
            : groupFiltered.filter((item) => sectorKey(item.sector) === sectorFilter)

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">观察列表</h1>
                <span className="quote-live-dot" title="行情每5秒自动刷新" />
                <div className="page-header-actions">
                    <button
                        className="btn-secondary"
                        onClick={handleRefreshSectors}
                        disabled={sectorRefreshing || items.length === 0}
                        title="重新获取所有自选股的板块-细分板块"
                    >
                        {sectorRefreshing ? '刷新中...' : '刷新板块'}
                    </button>
                </div>
            </div>

            {/* 分组标签栏 */}
            <div className="watchlist-groups">
                {groups.map((g) => (
                    <button
                        key={g}
                        className={`btn-day ${activeGroup === g ? 'active' : ''}`}
                        onClick={() => setActiveGroup(g)}
                    >
                        {g}
                    </button>
                ))}

            </div>

            {/* 板块筛选（叠加在自定义分组之上） */}
            {items.length > 0 && (
                <div className="sector-chips">
                    <button
                        className={`sector-chip ${sectorFilter === '全部' ? 'active' : ''}`}
                        onClick={() => setSectorFilter('全部')}
                    >
                        全部 <span className="chip-count">{items.length}</span>
                    </button>
                    {sectorCounts.map(([name, count]) => (
                        <button
                            key={name}
                            className={`sector-chip ${sectorFilter === name ? 'active' : ''}`}
                            onClick={() => setSectorFilter(name)}
                        >
                            {name} <span className="chip-count">{count}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="search-bar">
                <input
                    className="input"
                    placeholder="搜索股票代码或名称..."
                    value={keyword}
                    onChange={(e) => { setKeyword(e.target.value); setSearchDone(false) }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button className="btn-primary" onClick={handleSearch} disabled={searching}>
                    {searching ? '搜索中...' : '搜索'}
                </button>
            </div>

            {/* 批量导入 */}
            <div className="batch-import-box">
                <div className="batch-import-header">
                    <span className="batch-import-label">批量导入（粘贴截图文字或代码列表）</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <textarea
                        className="input"
                        rows={2}
                        placeholder="600519 贵州茅台&#10;000858 五粮液, 002594"
                        value={batchText}
                        onChange={(e) => handleBatchTextChange(e.target.value)}
                        style={{
                            flex: 1,
                            resize: 'vertical',
                            fontSize: 12,
                            fontFamily: 'monospace',
                        }}
                    />
                    <button
                        className="btn-secondary"
                        onClick={handleBatchImport}
                        disabled={batchImporting || batchParsed.length === 0}
                        style={{ whiteSpace: 'nowrap', alignSelf: 'flex-end' }}
                    >
                        {batchImporting ? '导入中...' : `添加 ${batchParsed.length} 个`}
                    </button>
                </div>
                {batchMsg && (
                    <div className="decision-hint" style={{ marginTop: 4 }}>
                        {batchMsg}
                    </div>
                )}
            </div>

            {(searchResults.length > 0 || searchDone) && (
                <div className="search-results">
                    {searching ? (
                        <div className="stock-search-empty">搜索中...</div>
                    ) : searchResults.length > 0 ? (
                        searchResults.map((r) => (
                            <div key={r.code} className="search-result-item">
                                <span className="stock-code">{r.code}</span>
                                <span className="stock-name">{r.name}</span>
                                <button className="btn-small" onClick={() => handleAdd(r.code, r.name)}>
                                    + 加入观察
                                </button>
                            </div>
                        ))
                    ) : (
                        <div className="stock-search-empty">
                            未找到相关股票，请尝试其他关键词
                        </div>
                    )}
                </div>
            )}

            {loading ? (
                <div className="loading">加载中...</div>
            ) : visibleItems.length === 0 ? (
                <div className="empty-state">
                    <p>
                        {activeGroup === ''
                            ? '观察列表为空，搜索股票添加'
                            : `"${activeGroup}"分组为空`}
                    </p>
                </div>
            ) : (
                <div className="watchlist">
                    {visibleItems.map((item) => {
                        const quote = quotes.get(item.code)
                        const currentGroup = itemGroups.get(item.id) ?? ''
                        return (
                            <div
                                key={item.id}
                                className={`watchlist-item ${quote && quote.changePercent >= 0 ? 'up' : quote && quote.changePercent < 0 ? 'down' : ''}`}
                                onClick={() =>
                                    navigate(
                                        `/realtime/${item.code}?name=${encodeURIComponent(item.name)}`
                                    )
                                }
                            >
                                <div className="stock-info">
                                    <span className="stock-code">{item.code}</span>
                                    <span className="stock-name">{item.name}</span>
                                    {(item.sector || item.sub_sector) && (
                                        <span
                                            className="sector-tag"
                                            title="点击编辑板块"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleEditSector(item)
                                            }}
                                        >
                                            {[item.sector, item.sub_sector].filter(Boolean).join(' · ')}
                                        </span>
                                    )}
                                    {currentGroup && (
                                        <span className="watchlist-group-badge">
                                            {currentGroup}
                                        </span>
                                    )}
                                </div>
                                {quote ? (
                                    <div className="quote-info">
                                        <span
                                            className="price"
                                            style={{ fontSize: 18, fontWeight: 700 }}
                                        >
                                            {quote.price}
                                        </span>
                                        <span
                                            className={`change ${quote.changePercent >= 0 ? 'up' : 'down'}`}
                                            style={{ fontSize: 15, fontWeight: 600 }}
                                        >
                                            {quote.changePercent >= 0 ? '+' : ''}
                                            {quote.changePercent.toFixed(2)}%
                                        </span>
                                        <span className="quote-detail">
                                            高{quote.high} 低{quote.low} 开{quote.open}
                                        </span>
                                    </div>
                                ) : (
                                    <span className="no-quote">行情加载中...</span>
                                )}
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {groups.length > 0 && (
                                        <select
                                            className="input group-select"
                                            value={currentGroup}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                                e.stopPropagation()
                                                setItemGroup(item.id, e.target.value)
                                            }}
                                        >
                                            <option value="">未分组</option>
                                            {groups.map((g) => (
                                                <option key={g} value={g}>
                                                    {g}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <button
                                        className="btn-small"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            navigate(
                                                `/stock/${item.code}?name=${encodeURIComponent(item.name)}`
                                            )
                                        }}
                                    >
                                        K线
                                    </button>
                                    <button
                                        className="btn-danger-small"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            removeItem(item.id)
                                        }}
                                    >
                                        移除
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
