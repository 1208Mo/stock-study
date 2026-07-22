import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWatchlistStore } from '../stores/watchlistStore'

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
        addGroup,
        removeGroup,
        setItemGroup,
    } = useWatchlistStore()
    const [keyword, setKeyword] = useState('')
    const [searchResults, setSearchResults] = useState<{ code: string; name: string }[]>([])
    const [searching, setSearching] = useState(false)
    const navigate = useNavigate()

    // 批量导入
    const [batchText, setBatchText] = useState('')
    const [batchParsed, setBatchParsed] = useState<string[]>([])
    const [batchImporting, setBatchImporting] = useState(false)
    const [batchMsg, setBatchMsg] = useState('')

    // 分组管理
    const [newGroupName, setNewGroupName] = useState('')
    const [activeGroup, setActiveGroup] = useState<string>('全部')

    useEffect(() => {
        fetchWatchlist()
        // 每5秒刷新一次行情
        const timer = setInterval(() => {
            useWatchlistStore.getState().refreshWatchlistQuotes()
        }, 5000)
        return () => clearInterval(timer)
    }, [])

    async function handleSearch() {
        if (!keyword.trim()) return
        setSearching(true)
        try {
            const results = await search(keyword)
            setSearchResults(results)
        } catch (e) {
            console.error(e)
        } finally {
            setSearching(false)
        }
    }

    async function handleAdd(code: string, name: string) {
        await addItem(code, name)
        setSearchResults([])
        setKeyword('')
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
                await addItem(code, name)
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

    const visibleItems =
        activeGroup === '全部'
            ? items
            : items.filter((item) => itemGroups.get(item.id) === activeGroup)

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">观察列表</h1>
                <span className="quote-live-dot" title="行情每5秒自动刷新" />
            </div>

            {/* 分组标签栏 */}
            <div className="watchlist-groups">
                {['全部', ...groups].map((g) => (
                    <button
                        key={g}
                        className={`btn-day ${activeGroup === g ? 'active' : ''}`}
                        onClick={() => setActiveGroup(g)}
                    >
                        {g}
                    </button>
                ))}
                <div className="group-add-inline">
                    <input
                        className="input group-name-input"
                        placeholder="新分组名"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && newGroupName.trim()) {
                                addGroup(newGroupName.trim())
                                setNewGroupName('')
                            }
                        }}
                    />
                    <button
                        className="btn-small"
                        onClick={() => {
                            if (newGroupName.trim()) {
                                addGroup(newGroupName.trim())
                                setNewGroupName('')
                            }
                        }}
                    >
                        + 新建
                    </button>
                    {activeGroup !== '全部' && (
                        <button
                            className="btn-danger-small"
                            onClick={() => {
                                removeGroup(activeGroup)
                                setActiveGroup('全部')
                            }}
                            title="删除该分组"
                        >
                            删除分组
                        </button>
                    )}
                </div>
            </div>

            <div className="search-bar">
                <input
                    className="input"
                    placeholder="搜索股票代码或名称..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
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

            {searchResults.length > 0 && (
                <div className="search-results">
                    {searchResults.map((r) => (
                        <div key={r.code} className="search-result-item">
                            <span className="stock-code">{r.code}</span>
                            <span className="stock-name">{r.name}</span>
                            <button className="btn-small" onClick={() => handleAdd(r.code, r.name)}>
                                + 加入观察
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="loading">加载中...</div>
            ) : visibleItems.length === 0 ? (
                <div className="empty-state">
                    <p>
                        {activeGroup === '全部'
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
                                className="watchlist-item"
                                onClick={() =>
                                    navigate(
                                        `/realtime/${item.code}?name=${encodeURIComponent(item.name)}`
                                    )
                                }
                            >
                                <div className="stock-info">
                                    <span className="stock-code">{item.code}</span>
                                    <span className="stock-name">{item.name}</span>
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
