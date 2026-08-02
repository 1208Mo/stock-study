import axios from 'axios'

export interface QuoteData {
    code: string
    name: string
    price: number
    change: number
    changePercent: number
    open: number
    high: number
    low: number
    volume: number
    amount: number
    timestamp: string
}

export interface KLineData {
    date: string
    open: number
    close: number
    low: number
    high: number
    volume: number
}

function getSecid(code: string): string {
    const normalized = code.trim()
    const isShanghai = /^[569]/.test(normalized)
    return `${isShanghai ? 1 : 0}.${normalized}`
}

// 新浪行情代码格式：sh600519 / sz000001
function getSinaSymbol(code: string): string {
    const normalized = code.trim()
    const isShanghai = /^[569]/.test(normalized)
    return `${isShanghai ? 'sh' : 'sz'}${normalized}`
}

// 东方财富实时行情
// 价格字段（f43/f44/f45/f46/f60）都是整数，真实价格 = 原值 / 10^f59
//   - 股票/指数：f59 = 2（如贵州茅台 f43=132946 → 1329.46）
//   - ETF/基金：f59 = 3（如 510760 f43=1268 → 1.268）
// 涨跌幅 f170 同理按 f152 位小数缩放（f152=2 时 -39 → -0.39%）
async function fetchQuoteFromEastmoney(code: string): Promise<QuoteData> {
    const url = `https://push2.eastmoney.com/api/qt/stock/get`
    const params = {
        secid: getSecid(code),
        fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f152,f170',
        ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    }

    const resp = await axios.get(url, { params, timeout: 5000 })
    const d = resp.data?.data

    if (!d || !d.f43) throw new Error(`eastmoney: no data for ${code}`)

    const decimals = typeof d.f59 === 'number' ? d.f59 : 2
    const scale = Math.pow(10, decimals)
    const price = d.f43 / scale
    const prevClose = d.f60 / scale
    const change = parseFloat((price - prevClose).toFixed(decimals))
    const changePercent = typeof d.f170 === 'number'
        ? d.f170 / Math.pow(10, typeof d.f152 === 'number' ? d.f152 : 2)
        : prevClose > 0
            ? parseFloat(((change / prevClose) * 100).toFixed(2))
            : 0

    return {
        code,
        name: d.f58,
        price,
        change,
        changePercent,
        open: d.f46 / scale,
        high: d.f44 / scale,
        low: d.f45 / scale,
        volume: d.f47,
        amount: d.f48,
        timestamp: new Date().toISOString(),
    }
}

// 新浪财经实时行情（备用）
// 响应格式: var hq_str_sh600519="贵州茅台,1750.00,1745.68,1785.00,1745.00,1750.00,1785.00,1750.00,12345,2345678,...";
async function fetchQuoteFromSina(code: string): Promise<QuoteData> {
    const symbol = getSinaSymbol(code)
    const url = `https://hq.sinajs.cn/list=${symbol}`

    const resp = await axios.get(url, {
        timeout: 5000,
        responseType: 'arraybuffer',
        headers: { Referer: 'https://finance.sina.com.cn' },
    })

    const iconv = await import('iconv-lite')
    const text: string = iconv.decode(Buffer.from(resp.data), 'gbk')
    const match = text.match(/="([^"]+)"/)
    if (!match) throw new Error(`sina: no data for ${code}`)

    const parts = match[1].split(',')
    if (parts.length < 10 || !parts[3]) throw new Error(`sina: empty quote for ${code}`)

    const name = parts[0]
    const open = parseFloat(parts[1])
    const prevClose = parseFloat(parts[2])
    const price = parseFloat(parts[3])
    const high = parseFloat(parts[4])
    const low = parseFloat(parts[5])
    const volume = parseFloat(parts[8])
    const amount = parseFloat(parts[9])

    // 新浪返回的就是真实价格，无需缩放
    const change = parseFloat((price - prevClose).toFixed(3))
    const changePercent =
        prevClose > 0
            ? parseFloat((((price - prevClose) / prevClose) * 100).toFixed(2))
            : 0

    return {
        code,
        name,
        price,
        change,
        changePercent,
        open,
        high,
        low,
        volume,
        amount,
        timestamp: new Date().toISOString(),
    }
}

// 主入口：东方财富优先，失败后 fallback 新浪
export async function fetchQuote(code: string): Promise<QuoteData> {
    const normalizedCode = code.trim()
    try {
        return await fetchQuoteFromEastmoney(normalizedCode)
    } catch {
        return await fetchQuoteFromSina(normalizedCode)
    }
}

// 批量获取行情
export async function fetchBatchQuotes(codes: string[]): Promise<QuoteData[]> {
    const results = await Promise.allSettled(codes.map((c) => fetchQuote(c)))
    return results
        .filter((r): r is PromiseFulfilledResult<QuoteData> => r.status === 'fulfilled')
        .map((r) => r.value)
}

// 东方财富 K 线数据（日线）
export async function fetchKLine(code: string, days: number = 60): Promise<KLineData[]> {
    const normalizedCode = code.trim()
    const symbol = getSinaSymbol(normalizedCode)

    // 新浪财经日K接口，scale=240 表示日线，datalen 取条数
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData`
    const params = {
        symbol,
        scale: 240,
        datalen: days,
        ma: 'no',
    }

    const resp = await axios.get(url, { params, timeout: 8000 })
    const list: Array<{
        day: string
        open: string
        high: string
        low: string
        close: string
        volume: string
    }> = resp.data ?? []

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`K线数据为空：${normalizedCode}`)
    }

    return list.map((item) => ({
        date: item.day,
        open: parseFloat(item.open),
        close: parseFloat(item.close),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        volume: parseFloat(item.volume),
    }))
}

// 5分钟K线（当日分时，用于T+0参考）
export async function fetchIntraday(code: string, bars: number = 48): Promise<KLineData[]> {
    const symbol = getSinaSymbol(code.trim())
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData`
    const params = { symbol, scale: 5, datalen: bars, ma: 'no' }

    const resp = await axios.get(url, { params, timeout: 8000 })
    const list: Array<{
        day: string
        open: string
        high: string
        low: string
        close: string
        volume: string
    }> = resp.data ?? []

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`分时数据为空：${code}`)
    }

    return list.map((item) => ({
        date: item.day,
        open: parseFloat(item.open),
        close: parseFloat(item.close),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        volume: parseFloat(item.volume),
    }))
}

// 周K线
export async function fetchWeeklyKLine(code: string, weeks: number = 60): Promise<KLineData[]> {
    const normalizedCode = code.trim()
    const symbol = getSinaSymbol(normalizedCode)
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData`
    const params = { symbol, scale: 1200, datalen: weeks, ma: 'no' }

    const resp = await axios.get(url, { params, timeout: 8000 })
    const list: Array<{
        day: string
        open: string
        high: string
        low: string
        close: string
        volume: string
    }> = resp.data ?? []

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`周K数据为空：${normalizedCode}`)
    }

    return list.map((item) => ({
        date: item.day,
        open: parseFloat(item.open),
        close: parseFloat(item.close),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        volume: parseFloat(item.volume),
    }))
}

// 月K线（用于长期支撑/压力判断）
// 优先用东方财富 klt=103（月线），失败再退到新浪 scale=7200
export async function fetchMonthlyKLine(code: string, months: number = 36): Promise<KLineData[]> {
    const normalizedCode = code.trim()
    // 东方财富月线
    try {
        const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
        const params = {
            secid: getSecid(normalizedCode),
            fields1: 'f1,f2,f3,f4,f5,f6',
            fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
            klt: 103,
            fqt: 1,
            beg: 0,
            end: 20500101,
            lmt: months,
            ut: 'bd1d9ddb04089700cf9c27f6f7426281',
        }
        const resp = await axios.get(url, {
            params,
            timeout: 8000,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Referer: 'https://quote.eastmoney.com/',
            },
        })
        const klines: string[] = resp.data?.data?.klines ?? []
        if (klines.length > 0) {
            return klines.map((line) => {
                const [date, open, close, high, low, volume] = line.split(',')
                return {
                    date,
                    open: parseFloat(open),
                    close: parseFloat(close),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    volume: parseFloat(volume),
                }
            })
        }
    } catch {
        // fallthrough to sina
    }
    // 新浪月线
    const symbol = getSinaSymbol(normalizedCode)
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData`
    const params = { symbol, scale: 7200, datalen: months, ma: 'no' }
    const resp = await axios.get(url, { params, timeout: 8000 })
    const list: Array<{
        day: string
        open: string
        high: string
        low: string
        close: string
        volume: string
    }> = resp.data ?? []
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`月K数据为空：${normalizedCode}`)
    }
    return list.map((item) => ({
        date: item.day,
        open: parseFloat(item.open),
        close: parseFloat(item.close),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        volume: parseFloat(item.volume),
    }))
}

// 东方财富快讯（用于 AI 分析今日市场热点）
export async function fetchMarketNews(count: number = 20): Promise<string[]> {
    const url = `https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_1_${count}_.html`
    const resp = await axios.get(url, {
        timeout: 8000,
        headers: { Referer: 'https://finance.eastmoney.com/a/caijingyaowen.html' },
    })
    const text: string = resp.data
    // 返回格式是 JS 赋值表达式，提取 JSON
    const match = text.match(/var ajaxResult=(\{.+\})/)
    if (!match) throw new Error('新闻接口解析失败')
    const json = JSON.parse(match[1])
    const list: Array<{ title: string }> = json?.LivesList ?? []
    return list.map((item) => item.title).filter(Boolean)
}

export interface StockSectorInfo {
    sector: string // 所属板块（如"科技"）
    subSector: string // 细分板块（如"半导体"）
}

// 东方财富板块信息
// 优先 push2 的 f127(所属行业)/f136(细分)；该接口被反爬时降级用 F10 公司概况的
// EM2016 行业分类（emweb.eastmoney.com 域名未被反爬，格式如"电子设备-半导体-集成电路"）
export async function fetchSectorInfo(code: string): Promise<StockSectorInfo> {
    const clean = code.trim()
    const secid = getSecid(clean)
    const ua =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

    // 1. 东财 push2（f127=所属行业、f136=细分）
    if (secid) {
        for (let i = 0; i < 2; i++) {
            try {
                const resp = await axios.get('https://push2.eastmoney.com/api/qt/stock/get', {
                    params: { secid, fields: 'f127,f136', ut: 'bd1d9ddb04089700cf9c27f6f7426281' },
                    timeout: 8000,
                    headers: { 'User-Agent': ua, Referer: 'https://quote.eastmoney.com/' },
                })
                const d = resp.data?.data ?? {}
                if (d.f127 || d.f136) {
                    return { sector: d.f127 || '', subSector: d.f136 || '' }
                }
                break // 被反爬返回空数据，转降级
            } catch {
                if (i < 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)))
            }
        }
    }

    // 2. 降级：东财 F10 公司概况（emweb 域名未被反爬），取 EM2016 行业分类
    const symbol = getSinaSymbol(clean) // sh600519 / sz000001
    try {
        const resp = await axios.get(
            'https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax',
            {
                params: { code: symbol },
                timeout: 8000,
                headers: { 'User-Agent': ua, Referer: 'https://emweb.securities.eastmoney.com/' },
            }
        )
        const em2016: string | undefined = resp.data?.jbzl?.[0]?.EM2016
        if (em2016) {
            const parts = em2016.split('-').map((s) => s.trim()).filter(Boolean)
            return {
                sector: parts[0] ?? '',
                subSector: parts.slice(1).join('-'),
            }
        }
    } catch {
        // ignore
    }
    return { sector: '', subSector: '' }
}

// 东方财富分红数据（近几年分红记录）
export interface DividendRecord {
    year: string
    reportDate: string
    divPerShare: number
    exDivDate: string
    recordDate: string
    planText?: string // 分红方案说明，如 "10派0.908元(含税,扣税后0.8172元)"
}

export async function fetchDividends(code: string): Promise<DividendRecord[]> {
    const url = 'https://datacenter.eastmoney.com/api/data/v1/get'
    const params = {
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1',
        pageSize: 10,
        pageNumber: 1,
        reportName: 'RPT_SHAREBONUS_DET',
        columns: 'REPORT_DATE,PRETAX_BONUS_RMB,EX_DIVIDEND_DATE,EQUITY_RECORD_DATE,IMPL_PLAN_PROFILE',
        filter: `(SECURITY_CODE="${code.trim()}")`,
        source: 'HSF',
        client: 'PC',
    }
    try {
        const resp = await axios.get(url, { params, timeout: 6000 })
        const rows: Array<{
            REPORT_DATE: string | null
            PRETAX_BONUS_RMB: number | null // 每10股派息(税前)，需 /10 转每股
            EX_DIVIDEND_DATE: string | null
            EQUITY_RECORD_DATE: string | null
            IMPL_PLAN_PROFILE?: string | null
        }> = resp.data?.result?.data ?? []
        return rows
            .filter((r) => r.PRETAX_BONUS_RMB != null && r.PRETAX_BONUS_RMB > 0)
            .map((r) => ({
                year: (r.REPORT_DATE ?? '').slice(0, 4),
                reportDate: (r.REPORT_DATE ?? '').slice(0, 10),
                divPerShare: (r.PRETAX_BONUS_RMB ?? 0) / 10,
                exDivDate: (r.EX_DIVIDEND_DATE ?? '').slice(0, 10),
                recordDate: (r.EQUITY_RECORD_DATE ?? '').slice(0, 10),
                planText: (r.IMPL_PLAN_PROFILE ?? '').trim(),
            }))
    } catch {
        return []
    }
}

export async function fetchTopSectors(
    topN: number = 10
): Promise<Array<{ name: string; changePercent: number; code: string }>> {
    // fs 参数含 + 号，axios params 会将其编码为 %2B 导致服务器拒绝，需手动拼到 URL
    const base = 'https://push2.eastmoney.com/api/qt/clist/get'
    const qs = `pn=1&pz=${topN}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f12,f14,f3`

    // 东方财富优先，失败后 fallback 新浪
    try {
        const resp = await axios.get(`${base}?${qs}`, {
            timeout: 6000,
            headers: { Referer: 'https://quote.eastmoney.com/' },
        })
        const list: Array<{ f12: string; f14: string; f3: number }> = resp.data?.data?.diff ?? []
        if (list.length > 0) {
            return list.map((item) => ({
                code: item.f12,
                name: item.f14,
                changePercent: item.f3 / 100,
            }))
        }
    } catch {
        // 东财挂了，降级新浪
    }

    // 新浪 fallback：vip.stock.finance.sina.com.cn/q/view/newSinaHy.php
    try {
        const sinaUrl = 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php'
        const resp = await axios.get(sinaUrl, {
            timeout: 8000,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                Referer: 'https://finance.sina.com.cn/',
            },
        })
        const iconv = await import('iconv-lite')
        const text: string = iconv.decode(Buffer.from(resp.data), 'gbk')
        const match = text.match(/var\s+S_Finance_bankuai_sinaindustry\s*=\s*(\{.*?\})\s*;?\s*$/m)
        if (!match) return []
        const raw: Record<string, string> = JSON.parse(match[1])
        return Object.entries(raw)
            .map(([key, val]) => {
                const parts = val.split(',')
                return {
                    code: key,
                    name: parts[1] ?? '',
                    changePercent: parseFloat(parts[5]) || 0,
                }
            })
            .sort((a, b) => b.changePercent - a.changePercent)
            .slice(0, topN)
    } catch {
        return []
    }
}

export async function searchStock(keyword: string): Promise<{ code: string; name: string }[]> {
    const url = `https://searchapi.eastmoney.com/api/suggest/get`
    const params = {
        input: keyword,
        type: 14,
        token: 'D43BF722C8E33BDC906FB84D85E326E8',
        count: 10,
    }

    const resp = await axios.get(url, { params, timeout: 5000 })
    const list = resp.data?.QuotationCodeTable?.Data ?? []

    return list.map((item: { Code: string; Name: string }) => ({
        code: item.Code,
        name: item.Name,
    }))
}

/**
 * 拉取某板块内今日涨幅前 topN 的个股
 * 东方财富：先查板块代码（bk:XXX），再按 f3（涨跌幅）降序取成分股
 */

// 查询板块的近N日K线（用于趋势展示）
export async function fetchSectorKLine(bkCode: string, days: number = 7): Promise<KLineData[]> {
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
    const params = {
        secid: `90.${bkCode}`,
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
        klt: 101,
        fqt: 0,
        beg: 0,
        end: 20500101,
        lmt: days,
        ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    }
    const emHeaders = {
        'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://quote.eastmoney.com/',
    }
    try {
        const resp = await axios.get(url, { params, timeout: 8000, headers: emHeaders })
        const klines: string[] = resp.data?.data?.klines ?? []
        if (!klines || klines.length === 0) return []
        return klines.map((line) => {
            const [date, open, close, high, low, volume] = line.split(',')
            return {
                date,
                open: parseFloat(open),
                close: parseFloat(close),
                high: parseFloat(high),
                low: parseFloat(low),
                volume: parseFloat(volume),
            }
        })
    } catch {
        return [] // 东财挂了，返回空数组而非抛错
    }
}
/**
 * 拉取某板块内今日涨幅前 topN 的个股
 * 直接用 fetchTopSectors 返回的 BK 板块代码查成分股，无需二次搜索
 */
export async function fetchSectorTopStocks(
    bkCode: string,
    topN: number = 5
): Promise<{ code: string; name: string; changePercent: number }[]> {
    try {
        const listUrl = 'https://push2.eastmoney.com/api/qt/clist/get'
        const listParams = {
            pn: 1,
            pz: topN,
            po: 1,
            np: 1,
            ut: 'bd1d9ddb04089700cf9c27f6f7426281',
            fltt: 2,
            invt: 2,
            fid: 'f3',
            fs: `b:${bkCode}`,
            fields: 'f12,f14,f3',
        }
        const listResp = await axios.get(listUrl, {
            params: listParams,
            timeout: 6000,
            headers: { Referer: 'https://quote.eastmoney.com/' },
        })
        const stocks: Array<{ f12: string; f14: string; f3: number }> =
            listResp.data?.data?.diff ?? []
        return stocks.map((s) => ({
            code: s.f12,
            name: s.f14,
            changePercent: s.f3 / 100,
        }))
    } catch {
        return [] // 东财挂了，返回空数组
    }
}

// ─── 潜伏板块识别 ────────────────────────────────────────────────────────
// 收集全网板块行情 + K线特征，找出"今日没爆发但趋势健康、量能温和放大"的埋伏候选
export interface AmbushSector {
    code: string
    name: string
    changePercent: number // 今日涨跌幅
    return5d: number // 近5日涨跌幅（收盘）
    return10d: number // 近10日涨跌幅
    volumeTrend: number // 近3日均量 / 前3日均量
    consolidation: number // 近5日高低差 / 均价，越小越紧
    distanceToHigh: number // 距离20日高点百分比（正=下方，接近0=临近突破）
    score: number
    reasons: string[]
}

// 获取全部行业板块（前 100 即接近全量）
export async function fetchAllSectors(
    topN: number = 100
): Promise<Array<{ name: string; changePercent: number; code: string }>> {
    return fetchTopSectors(topN)
}

export async function fetchAmbushSectors(limit: number = 8): Promise<AmbushSector[]> {
    // 1) 拉全部板块（按涨幅排序）
    const all = await fetchAllSectors(100)
    if (all.length === 0) return []

    // 2) 剔除今日过热（>2.5%）和过冷（<-1.5%）的板块，剩下的做埋伏候选
    const candidates = all.filter(
        (s) => s.changePercent >= -1.5 && s.changePercent <= 2.5
    )
    if (candidates.length === 0) return []

    // 3) 并发拉 20 日K线，个别失败不影响整体
    const withKline = await Promise.allSettled(
        candidates.map(async (s) => {
            const klines = await fetchSectorKLine(s.code, 20)
            return { sector: s, klines }
        })
    )

    // 4) 计算特征 + 打分
    const scored: AmbushSector[] = []
    for (const item of withKline) {
        if (item.status !== 'fulfilled') continue
        const { sector, klines } = item.value
        if (!klines || klines.length < 6) continue
        const closes = klines.map((k) => k.close)
        const highs = klines.map((k) => k.high)
        const vols = klines.map((k) => k.volume)
        const last = closes[closes.length - 1]
        if (!last) continue

        // 近5日/10日涨跌
        const close5 = closes[closes.length - 6] ?? closes[0]
        const close10 = closes[Math.max(0, closes.length - 11)] ?? closes[0]
        const return5d = ((last - close5) / close5) * 100
        const return10d = ((last - close10) / close10) * 100

        // 量能：近3日均量 / 前3日均量
        const recentVol = vols.slice(-3).reduce((a, b) => a + b, 0) / 3
        const priorVol = vols.slice(-6, -3).reduce((a, b) => a + b, 0) / 3 || recentVol
        const volumeTrend = priorVol > 0 ? recentVol / priorVol : 1

        // 近5日高低差
        const recent5 = klines.slice(-5)
        const hi5 = Math.max(...recent5.map((k) => k.high))
        const lo5 = Math.min(...recent5.map((k) => k.low))
        const avg5 = recent5.reduce((a, b) => a + b.close, 0) / recent5.length
        const consolidation = avg5 > 0 ? ((hi5 - lo5) / avg5) * 100 : 100

        // 距离20日高点
        const hi20 = Math.max(...highs)
        const distanceToHigh = hi20 > 0 ? ((hi20 - last) / hi20) * 100 : 100

        // 打分：温和上涨 + 量能温和放大 + 相对紧凑 + 接近前高
        let score = 0
        const reasons: string[] = []
        if (return5d >= 0 && return5d <= 6) {
            score += 20
            reasons.push(`近5日温和上涨 ${return5d.toFixed(2)}%`)
        } else if (return5d > 6) {
            score -= 10
        }
        if (return10d >= 0 && return10d <= 12) {
            score += 10
        }
        if (volumeTrend >= 1.1 && volumeTrend <= 2.5) {
            score += 20
            reasons.push(`量能温和放大 ${volumeTrend.toFixed(2)}x`)
        } else if (volumeTrend > 2.5) {
            score -= 5 // 过度放量往往意味着已启动
        }
        if (consolidation <= 5) {
            score += 15
            reasons.push(`近5日窄幅整理（${consolidation.toFixed(2)}%）`)
        }
        if (distanceToHigh >= 0 && distanceToHigh <= 4) {
            score += 20
            reasons.push(`距20日高点仅 ${distanceToHigh.toFixed(2)}%`)
        } else if (distanceToHigh <= 8) {
            score += 8
        }
        // 今日相对表现：小阳 > 平 > 微跌
        if (sector.changePercent >= 0 && sector.changePercent <= 1.5) {
            score += 8
        }
        if (score <= 0) continue

        scored.push({
            code: sector.code,
            name: sector.name,
            changePercent: sector.changePercent,
            return5d: Number(return5d.toFixed(2)),
            return10d: Number(return10d.toFixed(2)),
            volumeTrend: Number(volumeTrend.toFixed(2)),
            consolidation: Number(consolidation.toFixed(2)),
            distanceToHigh: Number(distanceToHigh.toFixed(2)),
            score,
            reasons,
        })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
}

/**
 * 拉取今日领涨板块的成分股，聚合成实时候选池
 * topSectorCount: 取几个领涨板块
 * perSector: 每个板块取几只
 */
export async function fetchDynamicCandidates(
    topSectorCount: number = 5,
    perSector: number = 4
): Promise<{ code: string; name: string }[]> {
    const sectors = await fetchTopSectors(topSectorCount)
    const results = await Promise.allSettled(
        sectors.map((s) => fetchSectorTopStocks(s.code, perSector))
    )
    const seen = new Set<string>()
    const candidates: { code: string; name: string }[] = []
    for (const r of results) {
        if (r.status !== 'fulfilled') continue
        for (const stock of r.value) {
            if (!seen.has(stock.code)) {
                seen.add(stock.code)
                candidates.push({ code: stock.code, name: stock.name })
            }
        }
    }
    return candidates
}

// ─── 热门板块近7日趋势（成分股聚合走势） ────────────────────────────────
// 背景：东财 push2his 板块K线接口已被反爬限制，新浪又无直接的板块历史K线接口
// （getKLineData / ssl_qsfx_zjlrqs / hq.sinajs.cn 均不接受 new_blhy 板块代码）。
// 方案：用新浪 Market_Center.getHQNodeData 取板块成交额前N成分股，
//       再逐个取新浪个股日K，按「首日收盘价归一化为100」等权平均，合成板块相对走势。

export interface SectorTrendItem {
    code: string
    name: string
    changePercent: number // 今日涨跌幅
    return7d: number // 7日累计涨幅（%）
    klines: KLineData[] // 归一化聚合走势（首日 close=100）
    leaderName: string // 成交额第一的成分股名称（代表股）
}

// 简单并发池：同时最多 limit 个 in-flight，防新浪反爬
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let cursor = 0
    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const i = cursor++
            results[i] = await fn(items[i], i)
        }
    }
    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
    await Promise.all(workers)
    return results
}

// 新浪板块成分股（按成交额降序取前N）
export async function fetchSectorConstituents(
    sectorCode: string,
    topN: number = 3
): Promise<Array<{ code: string; name: string; amount: number }>> {
    const url =
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData'
    const params = {
        page: 1,
        num: topN,
        sort: 'amount',
        asc: 0,
        node: sectorCode,
        _s_r_a: 'auto',
    }
    try {
        const resp = await axios.get(url, {
            params,
            timeout: 8000,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Referer: 'https://vip.stock.finance.sina.com.cn/',
            },
        })
        const list: Array<{ code: string; name: string; amount: number }> = resp.data ?? []
        if (!Array.isArray(list)) return []
        return list.map((s) => ({
            code: s.code,
            name: s.name,
            amount: Number(s.amount) || 0,
        }))
    } catch {
        return []
    }
}

// 归一化聚合：多只成分股日K → 板块相对走势（首日 close=100）
// 每只股按首个共有日收盘价归一，每日取各成分股归一值均值；volume 取成分股当日成交量合计
function aggregateSectorTrend(stockKlines: KLineData[][]): KLineData[] {
    const valid = stockKlines.filter((k) => Array.isArray(k) && k.length >= 2)
    if (valid.length === 0) return []

    // 取所有成分股共有日期的交集
    const dateSets = valid.map((ks) => new Set(ks.map((k) => k.date)))
    let commonDates = [...dateSets[0]]
    for (let i = 1; i < dateSets.length; i++) {
        commonDates = commonDates.filter((d) => dateSets[i].has(d))
    }
    commonDates.sort()
    if (commonDates.length < 2) return []

    const firstDate = commonDates[0]

    return commonDates.map((date) => {
        const rels: number[] = []
        let totalVol = 0
        for (const ks of valid) {
            const firstBar = ks.find((k) => k.date === firstDate)
            const bar = ks.find((k) => k.date === date)
            if (firstBar && firstBar.close > 0 && bar) {
                rels.push((bar.close / firstBar.close) * 100)
                totalVol += bar.volume
            }
        }
        const avg = rels.length > 0 ? rels.reduce((a, b) => a + b, 0) / rels.length : 100
        return {
            date,
            open: Number(avg.toFixed(4)),
            close: Number(avg.toFixed(4)),
            high: Number(avg.toFixed(4)),
            low: Number(avg.toFixed(4)),
            volume: totalVol,
        }
    })
}

/**
 * 热门板块近7日趋势
 * 取板块列表 → 每板块取成交额前3成分股 → 聚合7日走势 → 按7日涨幅降序
 */
export async function fetchTopSectorTrends(
    topN: number = 12,
    days: number = 7
): Promise<SectorTrendItem[]> {
    const sectors = await fetchTopSectors(topN)
    if (sectors.length === 0) return []

    const results = await mapWithConcurrency(sectors, 6, async (sector) => {
        try {
            const constituents = await fetchSectorConstituents(sector.code, 3)
            if (constituents.length === 0) return null

            const stockKlines = await mapWithConcurrency(
                constituents,
                3,
                async (c) => {
                    try {
                        return await fetchKLine(c.code, days)
                    } catch {
                        return [] as KLineData[]
                    }
                }
            )

            const klines = aggregateSectorTrend(stockKlines)
            if (klines.length < 2) return null

            const first = klines[0].close
            const last = klines[klines.length - 1].close
            const return7d = first > 0 ? ((last - first) / first) * 100 : 0

            return {
                code: sector.code,
                name: sector.name,
                changePercent: sector.changePercent,
                return7d: Number(return7d.toFixed(2)),
                klines,
                leaderName: constituents[0]?.name ?? '',
            }
        } catch {
            return null
        }
    })

    return results
        .filter((r): r is SectorTrendItem => r !== null)
        .sort((a, b) => b.return7d - a.return7d)
}
