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
async function fetchQuoteFromEastmoney(code: string): Promise<QuoteData> {
    const url = `https://push2.eastmoney.com/api/qt/stock/get`
    const params = {
        secid: getSecid(code),
        fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f170',
        ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    }

    const resp = await axios.get(url, { params, timeout: 5000 })
    const d = resp.data?.data

    if (!d || !d.f43) throw new Error(`eastmoney: no data for ${code}`)

    const price = d.f43 / 100
    const prevClose = d.f60 / 100
    const change = parseFloat((price - prevClose).toFixed(2))
    const changePercent = parseFloat(((change / prevClose) * 100).toFixed(2))

    return {
        code,
        name: d.f58,
        price,
        change,
        changePercent,
        open: d.f46 / 100,
        high: d.f44 / 100,
        low: d.f45 / 100,
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
    const change = parseFloat((price - prevClose).toFixed(2))
    const changePercent = parseFloat(((change / prevClose) * 100).toFixed(2))

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

// 东方财富板块信息（f127=所属行业、f136=细分）
export async function fetchSectorInfo(code: string): Promise<StockSectorInfo> {
    const url = 'https://push2.eastmoney.com/api/qt/stock/get'
    const params = {
        secid: getSecid(code.trim()),
        fields: 'f127,f136',
        ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    }
    const resp = await axios.get(url, { params, timeout: 5000 })
    const d = resp.data?.data ?? {}
    return {
        sector: d.f127 || '',
        subSector: d.f136 || '',
    }
}

// 东方财富分红数据（近几年分红记录）
export interface DividendRecord {
    year: string
    reportDate: string
    divPerShare: number
    exDivDate: string
    recordDate: string
}

export async function fetchDividends(code: string): Promise<DividendRecord[]> {
    const url = 'https://datacenter.eastmoney.com/api/data/v1/get'
    const params = {
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1',
        pageSize: 10,
        pageNumber: 1,
        reportName: 'RPT_SHAREHOLDER_ALLOTMENT',
        columns: 'REPORT_DATE,PER_SHARE_PRETAX_BONUS,EX_DIVIDEND_DATE,EQUITY_DATE',
        filter: `(SECURITY_CODE="${code.trim()}")`,
        source: 'HSF',
        client: 'PC',
    }
    try {
        const resp = await axios.get(url, { params, timeout: 6000 })
        const rows: Array<{
            REPORT_DATE: string
            PER_SHARE_PRETAX_BONUS: number | null
            EX_DIVIDEND_DATE: string | null
            EQUITY_DATE: string | null
        }> = resp.data?.result?.data ?? []
        return rows
            .filter((r) => r.PER_SHARE_PRETAX_BONUS != null && r.PER_SHARE_PRETAX_BONUS > 0)
            .map((r) => ({
                year: (r.REPORT_DATE ?? '').slice(0, 4),
                reportDate: (r.REPORT_DATE ?? '').slice(0, 10),
                divPerShare: r.PER_SHARE_PRETAX_BONUS ?? 0,
                exDivDate: (r.EX_DIVIDEND_DATE ?? '').slice(0, 10),
                recordDate: (r.EQUITY_DATE ?? '').slice(0, 10),
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

    const resp = await axios.get(`${base}?${qs}`, {
        timeout: 6000,
        headers: { Referer: 'https://quote.eastmoney.com/' },
    })
    const list: Array<{ f12: string; f14: string; f3: number }> = resp.data?.data?.diff ?? []
    return list.map((item) => ({
        code: item.f12,
        name: item.f14,
        changePercent: item.f3 / 100,
    }))
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
    const resp = await axios.get(url, { params, timeout: 6000 })
    const klines: string[] = resp.data?.data?.klines ?? []
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
/**
 * 拉取某板块内今日涨幅前 topN 的个股
 * 直接用 fetchTopSectors 返回的 BK 板块代码查成分股，无需二次搜索
 */
export async function fetchSectorTopStocks(
    bkCode: string,
    topN: number = 5
): Promise<{ code: string; name: string; changePercent: number }[]> {
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
    const stocks: Array<{ f12: string; f14: string; f3: number }> = listResp.data?.data?.diff ?? []

    return stocks.map((s) => ({
        code: s.f12,
        name: s.f14,
        changePercent: s.f3 / 100,
    }))
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
