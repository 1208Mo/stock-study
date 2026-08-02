import axios from 'axios'
import type { KLineData } from './market'

// 单日资金流向（日K中的一条）
export interface CapitalFlowDaily {
    date: string // '2026-07-31'
    mainNet: number // 主力净流入（元，负=流出）
    smallNet: number // 小单净流入
    mediumNet: number // 中单净流入
    largeNet: number // 大单净流入
    superLargeNet: number // 超大单净流入
    mainPct: number // 主力净流入占比（%）
    close: number // 收盘价
    changePercent: number // 涨跌幅（%）
}

// 大盘当日资金流向快照
export interface MarketFlowSnapshot {
    name: string // '上证指数'
    code: string // '000001'
    changePercent: number // 涨跌幅（%）
    mainNet: number // 主力净流入（元）（新浪指数行情接口无此字段，恒为0）
    superLargeNet: number
    largeNet: number
    mediumNet: number
    smallNet: number
    mainPct: number
}

// 行业板块资金流向排行（单条）
export interface SectorCapitalFlow {
    code: string // 板块标识
    name: string // 板块名称
    changePercent: number // 今日涨跌幅（%）
    mainNet: number // 成交额（元），作为资金关注度的代理指标
    mainPct: number // 换手率（%）
    superLargeNet: number
    largeNet: number
    mediumNet: number
    smallNet: number
}

const SINA_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * 生成新浪财经 symbol（sh/sz + 代码）
 * 上证指数 000001 → sh000001（需显式 market='sh'）
 */
function getSinaSymbol(code: string, market?: 'sh' | 'sz'): string {
    const normalized = code.trim()
    if (market === 'sh') return `sh${normalized}`
    if (market === 'sz') return `sz${normalized}`
    const isShanghai = /^[569]/.test(normalized)
    return `${isShanghai ? 'sh' : 'sz'}${normalized}`
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let lastErr: unknown
    for (let i = 0; i < retries; i++) {
        try {
            return await fn()
        } catch (err) {
            lastErr = err
            if (i < retries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)))
        }
    }
    throw lastErr
}

/**
 * 个股资金流向日K
 * 数据源：新浪财经 MoneyFlow.ssl_qsfx_zjlrqs
 * 返回：opendate(日期), trade(收盘价), changeratio(涨跌幅), netamount(净流入), r0_net(主力净流入), r0_ratio(主力占比)
 */
export async function fetchCapitalFlowDaily(
    code: string,
    days: number = 30,
    market?: 'sh' | 'sz'
): Promise<CapitalFlowDaily[]> {
    const symbol = getSinaSymbol(code, market)
    const url =
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs'
    const params = { page: 1, num: days, sort: 'opendate', asc: 0, daima: symbol }

    return withRetry(async () => {
        const resp = await axios.get(url, {
            params,
            timeout: 8000,
            headers: { 'User-Agent': SINA_UA, Referer: 'https://vip.stock.finance.sina.com.cn/' },
        })
        const list: Array<{
            opendate: string
            trade: string
            changeratio: string
            netamount: string
            r0_net: string
            r0_ratio: string
        }> = resp.data ?? []
        if (!Array.isArray(list) || list.length === 0) return []
        return list.map((item) => ({
            date: item.opendate,
            mainNet: parseFloat(item.r0_net) || 0,
            smallNet: 0,
            mediumNet: 0,
            largeNet: 0,
            superLargeNet: 0,
            mainPct: (parseFloat(item.r0_ratio) || 0) * 100,
            close: parseFloat(item.trade) || 0,
            changePercent: (parseFloat(item.changeratio) || 0) * 100,
        }))
    })
}

/**
 * 个股/指数/ETF 日K线（量价图数据源）
 * 数据源：新浪财经 CN_MarketData.getKLineData
 */
export async function fetchDailyKLine(
    code: string,
    days: number = 30,
    market?: 'sh' | 'sz'
): Promise<KLineData[]> {
    const symbol = getSinaSymbol(code, market)
    const url =
        'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'
    const params = { symbol, scale: 240, datalen: days, ma: 'no' }

    return withRetry(async () => {
        const resp = await axios.get(url, { params, timeout: 8000 })
        const list: Array<{
            day: string
            open: string
            high: string
            low: string
            close: string
            volume: string
        }> = resp.data ?? []
        if (!Array.isArray(list) || list.length === 0) return []
        return list.map((item) => ({
            date: item.day.slice(0, 10),
            open: parseFloat(item.open),
            close: parseFloat(item.close),
            high: parseFloat(item.high),
            low: parseFloat(item.low),
            volume: parseFloat(item.volume),
        }))
    })
}

/**
 * 行业板块行情排行（按成交额降序）
 * 数据源：新浪财经 newSinaHy.php
 * 响应为 GBK 编码的 JS 变量赋值：
 *   var S_Finance_bankuai_sinaindustry = {"key":"name,count,avgPrice,changeAmt,changePct,volume,turnover,...",...}
 * 用成交额（turnover）作为资金关注度的代理指标
 */
export async function fetchSectorCapitalFlow(
    topN: number = 15
): Promise<SectorCapitalFlow[]> {
    const url = 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php'

    return withRetry(async () => {
        const resp = await axios.get(url, {
            timeout: 8000,
            responseType: 'arraybuffer',
            headers: { 'User-Agent': SINA_UA, Referer: 'https://finance.sina.com.cn/' },
        })
        const iconv = await import('iconv-lite')
        const text: string = iconv.decode(Buffer.from(resp.data), 'gbk')

        // 提取 JSON 对象
        const match = text.match(/var\s+S_Finance_bankuai_sinaindustry\s*=\s*(\{.*?\})\s*;?\s*$/m)
        if (!match) throw new Error('新浪板块行情：响应格式异常')
        const raw: Record<string, string> = JSON.parse(match[1])

        // 解析每个板块：格式 "name,count,avgPrice,changeAmt,changePct,volume,turnover,..."
        const sectors = Object.entries(raw).map(([key, val]) => {
            const parts = val.split(',')
            return {
                code: key,
                name: parts[1] ?? '',
                count: parseInt(parts[2]) || 0,
                avgPrice: parseFloat(parts[3]) || 0,
                changeAmt: parseFloat(parts[4]) || 0,
                changePct: parseFloat(parts[5]) || 0, // 小数形式，如 2.98 = 2.98%
                volume: parseFloat(parts[6]) || 0,
                turnover: parseFloat(parts[7]) || 0, // 成交额（元）
                leaderCode: parts[8] ?? '',
                leaderPrice: parseFloat(parts[9]) || 0,
            }
        })

        // 按成交额降序
        sectors.sort((a, b) => b.turnover - a.turnover)

        return sectors.slice(0, topN).map((s) => ({
            code: s.code,
            name: s.name,
            changePercent: s.changePct,
            mainNet: s.turnover,
            mainPct: s.avgPrice > 0 ? (s.volume / (s.avgPrice * 1e8)) * 100 : 0,
            superLargeNet: 0,
            largeNet: 0,
            mediumNet: 0,
            smallNet: 0,
        }))
    })
}

/**
 * 大盘指数实时行情快照（上证/深证/创业板）
 * 数据源：新浪财经 hq.sinajs.cn
 * 注意：新浪指数接口无主力净流入数据，mainNet 恒为 0
 */
export async function fetchMarketFlowSnapshot(): Promise<MarketFlowSnapshot[]> {
    const symbols = 'sh000001,sz399001,sz399006'
    const url = `https://hq.sinajs.cn/list=${symbols}`

    return withRetry(async () => {
        const resp = await axios.get(url, {
            timeout: 6000,
            responseType: 'arraybuffer',
            headers: { 'User-Agent': SINA_UA, Referer: 'https://finance.sina.com.cn' },
        })
        const iconv = await import('iconv-lite')
        const text: string = iconv.decode(Buffer.from(resp.data), 'gbk')

        const results: MarketFlowSnapshot[] = []
        const lines = text.trim().split('\n')
        for (const line of lines) {
            const match = line.match(/="([^"]+)"/)
            if (!match) continue
            const parts = match[1].split(',')
            if (parts.length < 10) continue
            const name = parts[0]
            const price = parseFloat(parts[3])
            const prevClose = parseFloat(parts[2])
            const changePercent =
                prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0
            results.push({
                name,
                code: match[0].includes('sh000001')
                    ? '000001'
                    : match[0].includes('sz399001')
                      ? '399001'
                      : '399006',
                changePercent: parseFloat(changePercent.toFixed(2)),
                mainNet: 0,
                superLargeNet: 0,
                largeNet: 0,
                mediumNet: 0,
                smallNet: 0,
                mainPct: 0,
            })
        }
        return results
    })
}
