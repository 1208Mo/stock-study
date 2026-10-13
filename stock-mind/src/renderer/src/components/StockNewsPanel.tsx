import { useEffect, useState } from 'react'
import type { NewsSentiment, StockNewsItem } from '../types'

interface Props {
    code: string
    name: string
}

const SENTIMENT_META: Record<NewsSentiment['sentiment'], { label: string; cls: string }> = {
    positive: { label: '利好', cls: 'up' },
    negative: { label: '利空', cls: 'down' },
    neutral: { label: '中性', cls: 'neutral' },
}

export default function StockNewsPanel({ code, name }: Props) {
    const [tab, setTab] = useState<'news' | 'notice'>('news')
    const [items, setItems] = useState<Record<'news' | 'notice', StockNewsItem[] | null>>({
        news: null,
        notice: null,
    })
    const [error, setError] = useState<string | null>(null)
    const [sentiments, setSentiments] = useState<Record<string, NewsSentiment>>({})
    const [tagging, setTagging] = useState(false)
    const [tagError, setTagError] = useState<string | null>(null)

    useEffect(() => {
        setItems({ news: null, notice: null })
        setSentiments({})
        setTagError(null)
        setError(null)
    }, [code])

    useEffect(() => {
        if (items[tab] !== null) return
        let cancelled = false
        const req = tab === 'news' ? window.api.stock.news(code, 25) : window.api.stock.notices(code, 25)
        req
            .then((r) => !cancelled && setItems((prev) => ({ ...prev, [tab]: r })))
            .catch((e) => !cancelled && setError(String(e)))
        return () => {
            cancelled = true
        }
    }, [tab, code, items])

    const list = items[tab]

    const runTagging = async () => {
        if (!list || list.length === 0) return
        setTagging(true)
        setTagError(null)
        try {
            const res = await window.api.stock.tagSentiment(
                { code, name },
                list.slice(0, 25).map((it) => ({ id: it.id, title: it.title, summary: it.summary }))
            )
            setSentiments((prev) => ({ ...prev, ...Object.fromEntries(res.map((r) => [r.id, r])) }))
        } catch (e) {
            setTagError(e instanceof Error ? e.message : String(e))
        } finally {
            setTagging(false)
        }
    }

    const taggedCount = list ? list.filter((it) => sentiments[it.id]).length : 0

    return (
        <div className="kline-ai-section news-panel">
            <div className="dash-card-header">
                <h3>消息面</h3>
                <div className="pa-tabs news-panel-tabs">
                    <button className={`pa-tab ${tab === 'news' ? 'active' : ''}`} onClick={() => setTab('news')}>
                        新闻
                    </button>
                    <button className={`pa-tab ${tab === 'notice' ? 'active' : ''}`} onClick={() => setTab('notice')}>
                        公告
                    </button>
                </div>
                <button className="btn-small" onClick={runTagging} disabled={tagging || !list || list.length === 0}>
                    {tagging ? 'AI 解读中…' : taggedCount > 0 ? '重新解读' : '✨ AI 标利好/利空'}
                </button>
            </div>

            {tagError && <div className="alert-error">AI 解读失败：{tagError}</div>}

            {list === null ? (
                error ? (
                    <div className="dash-muted">加载失败：{error}</div>
                ) : (
                    <div className="dash-skeleton" style={{ height: 200 }} />
                )
            ) : list.length === 0 ? (
                <div className="dash-empty">暂无{tab === 'news' ? '相关新闻' : '公告'}</div>
            ) : (
                <ul className="news-list stock-news-list">
                    {list.map((it) => {
                        const s = sentiments[it.id]
                        const meta = s ? SENTIMENT_META[s.sentiment] : null
                        return (
                            <li key={it.id} className="news-item">
                                <div className="stock-news-row">
                                    <span className="news-time">{it.time.slice(5, 16)}</span>
                                    {meta && <span className={`news-tag ${meta.cls}`}>{meta.label}</span>}
                                    <a className="news-title" href={it.url} target="_blank" rel="noreferrer">
                                        {it.title}
                                    </a>
                                    {it.source && <span className="dash-muted news-source">{it.source}</span>}
                                </div>
                                {s?.reason && <div className="news-body">AI：{s.reason}</div>}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
