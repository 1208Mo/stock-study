/**
 * 个股新闻与公告
 * - 新闻：东方财富个股资讯列表，按股票代码
 * - 公告：东方财富公告中心，按股票代码
 * - AI 情绪标注：把标题交给大模型，输出每条的利好/利空/中性和一句话理由
 */

import axios from 'axios'
import { callAI, type AIProvider } from './ai'

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface StockNewsItem {
    id: string
    kind: 'news' | 'notice'
    title: string
    summary: string
    source: string
    time: string
    url: string
}

export async function fetchStockNews(code: string, count: number = 20): Promise<StockNewsItem[]> {
    const market = /^[569]/.test(code) ? 1 : 0
    const resp = await axios.get('https://np-listapi.eastmoney.com/comm/web/getListInfo', {
        params: { client: 'web', biz: 'web_stock', mTypeAndCode: `${market}.${code}`, type: 1, pageSize: count, req_trace: Date.now() },
        timeout: 8000,
        headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
    })
    const list: Array<Record<string, string>> = resp.data?.data?.list ?? []
    return list.map((it) => ({
        id: `n-${it.Art_Code}`,
        kind: 'news' as const,
        title: it.Art_Title || '',
        summary: '',
        source: '东方财富',
        time: it.Art_ShowTime || '',
        url: (it.Art_Url || it.Art_OriginUrl || '').replace(/^http:/, 'https:'),
    }))
}

export async function fetchStockNotices(code: string, count: number = 20): Promise<StockNewsItem[]> {
    const resp = await axios.get('https://np-anotice-stock.eastmoney.com/api/security/ann', {
        params: { sr: -1, page_size: count, page_index: 1, ann_type: 'A', client_source: 'web', stock_list: code },
        timeout: 8000,
        headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/notices/' },
    })
    const list: Array<Record<string, unknown>> = resp.data?.data?.list ?? []
    return list.map((it) => {
        const columns = (it.columns as Array<{ column_name: string }> | undefined) ?? []
        return {
            id: `a-${it.art_code}`,
            kind: 'notice' as const,
            // 标题形如「贵州茅台:关于xxx的公告」，去掉前缀
            title: String(it.title_ch || it.title || '').replace(/^[^:：]{1,12}[:：]/, ''),
            summary: '',
            source: columns.map((c) => c.column_name).join(' / '),
            time: String(it.notice_date || it.display_time || '').slice(0, 10),
            url: `https://data.eastmoney.com/notices/detail/${code}/${it.art_code}.html`,
        }
    })
}

export interface NewsSentiment {
    id: string
    sentiment: 'positive' | 'negative' | 'neutral'
    reason: string
}

export async function tagNewsSentiment(
    ai: { provider: AIProvider; apiKey: string; baseUrl?: string; model?: string },
    stock: { code: string; name: string },
    items: Array<{ id: string; title: string; summary?: string }>
): Promise<NewsSentiment[]> {
    if (items.length === 0) return []
    const lines = items
        .slice(0, 30)
        .map((it, i) => `${i + 1}. ${it.title}${it.summary ? `（${it.summary.slice(0, 60)}）` : ''}`)
        .join('\n')
    const res = await callAI(ai.provider, { apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model }, [
        {
            role: 'system',
            content:
                '你是 A 股新闻解读助手。判断每条新闻/公告对指定股票的短期影响：positive=利好，negative=利空，neutral=中性或与该股关系不大。' +
                '只输出 JSON 数组，不要其他文字。格式：[{"i":序号,"s":"positive|negative|neutral","r":"不超过20字的理由，用新手能懂的话"}]',
        },
        { role: 'user', content: `股票：${stock.name}（${stock.code}）\n\n${lines}` },
    ])
    const m = res.content.match(/\[[\s\S]*\]/)
    if (!m) throw new Error('AI 返回格式无法解析')
    const parsed: Array<{ i: number; s: string; r?: string }> = JSON.parse(m[0])
    return parsed
        .filter((p) => items[p.i - 1])
        .map((p) => ({
            id: items[p.i - 1].id,
            sentiment: p.s === 'positive' || p.s === 'negative' ? p.s : 'neutral',
            reason: p.r ?? '',
        }))
}
