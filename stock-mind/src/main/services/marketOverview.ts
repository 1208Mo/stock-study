/**
 * 市场总览（首页仪表盘）数据源
 *
 * - 指数行情条：东方财富 ulist 接口，直接用 secid（1.=沪 0.=深 100.=海外），
 *   不走 getSecid，避免上证指数 000001 被误判成深市平安银行。失败降级新浪。
 * - 涨跌家数：上证指数 / 深证成指的 f104/f105/f106 即两市全市场上涨/下跌/平盘家数。
 * - 涨停/跌停/炸板池：东方财富 push2ex 题材池，非交易日返回空，需要往前回溯。
 * - 板块热力图：东方财富行业板块按成交额排序，失败降级新浪行业。
 * - 快讯：东方财富 7x24 快讯，带摘要和原文链接。
 *
 * 东方财富 push2 对高频请求会临时断开连接，所以每个接口都带短缓存。
 */

import axios from 'axios'
import { withPush2 } from './dataSource'

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const EM_HEADERS = { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' }
const SINA_HEADERS = { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' }

function cached<A extends unknown[], T>(ttlMs: number, fn: (...args: A) => Promise<T>) {
    const store = new Map<string, { value: T; expiresAt: number }>()
    const inFlight = new Map<string, Promise<T>>()
    return (...args: A): Promise<T> => {
        const key = JSON.stringify(args)
        const hit = store.get(key)
        if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value)
        const pending = inFlight.get(key)
        if (pending) return pending
        const p = fn(...args)
            .then((value) => {
                store.set(key, { value, expiresAt: Date.now() + ttlMs })
                return value
            })
            .finally(() => inFlight.delete(key))
        inFlight.set(key, p)
        return p
    }
}

async function fetchSinaText(url: string): Promise<string> {
    const resp = await axios.get(url, { timeout: 6000, responseType: 'arraybuffer', headers: SINA_HEADERS })
    const iconv = await import('iconv-lite')
    return iconv.decode(Buffer.from(resp.data), 'gbk')
}

// ─── 指数行情条 ─────────────────────────────────────────────────────────

export interface IndexTick {
    code: string
    name: string
    price: number
    change: number
    changePercent: number
}

const INDEXES: Array<{ secid: string; sina: string; name: string }> = [
    { secid: '1.000001', sina: 's_sh000001', name: '上证指数' },
    { secid: '0.399001', sina: 's_sz399001', name: '深证成指' },
    { secid: '0.399006', sina: 's_sz399006', name: '创业板指' },
    { secid: '1.000300', sina: 's_sh000300', name: '沪深300' },
    { secid: '1.000688', sina: 's_sh000688', name: '科创50' },
    { secid: '100.HSI', sina: 'rt_hkHSI', name: '恒生指数' },
    { secid: '100.NDX', sina: 'gb_ndx', name: '纳斯达克100' },
]

async function fetchIndexTickerFromEastmoney(): Promise<IndexTick[]> {
    const resp = await withPush2(() =>
        axios.get('https://push2.eastmoney.com/api/qt/ulist.np/get', {
            params: { fltt: 2, secids: INDEXES.map((i) => i.secid).join(','), fields: 'f2,f3,f4,f12,f14' },
            timeout: 5000,
            headers: EM_HEADERS,
        })
    )
    const list: Array<Record<string, unknown>> = resp.data?.data?.diff ?? []
    const result = list
        .filter((d) => typeof d.f2 === 'number')
        .map((d) => ({
            code: String(d.f12),
            name: String(d.f14),
            price: d.f2 as number,
            change: Number(d.f4) || 0,
            changePercent: Number(d.f3) || 0,
        }))
    if (result.length === 0) throw new Error('eastmoney: empty index ticker')
    return result
}

// 新浪三种格式：
//   s_shXXXXXX  名称,点位,涨跌额,涨跌幅,...
//   rt_hkHSI    代码,名称,今开,昨收,最高,最低,现价,涨跌额,涨跌幅,...
//   gb_ndx      名称,现价,涨跌幅,时间,涨跌额,...
async function fetchIndexTickerFromSina(): Promise<IndexTick[]> {
    const text = await fetchSinaText(`https://hq.sinajs.cn/list=${INDEXES.map((i) => i.sina).join(',')}`)
    const result: IndexTick[] = []
    for (const idx of INDEXES) {
        const m = text.match(new RegExp(`hq_str_${idx.sina}="([^"]*)"`))
        if (!m || !m[1]) continue
        const p = m[1].split(',')
        const code = idx.secid.split('.')[1]
        let price: number, change: number, pct: number
        if (idx.sina.startsWith('s_')) {
            ;[price, change, pct] = [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]
        } else if (idx.sina.startsWith('rt_hk')) {
            ;[price, change, pct] = [parseFloat(p[6]), parseFloat(p[7]), parseFloat(p[8])]
        } else {
            ;[price, pct, change] = [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[4])]
        }
        if (!Number.isFinite(price)) continue
        result.push({ code, name: idx.name, price, change: change || 0, changePercent: pct || 0 })
    }
    return result
}

export const fetchIndexTicker = cached(5000, async (): Promise<IndexTick[]> => {
    try {
        return await fetchIndexTickerFromEastmoney()
    } catch {
        return fetchIndexTickerFromSina()
    }
})

// ─── 市场情绪：涨跌家数 + 涨跌停 + 连板梯队 ─────────────────────────────

export interface LimitUpStock {
    code: string
    name: string
    /** 连板数：1=首板 */
    boards: number
    industry: string
    /** 首次封板时间 HH:MM */
    firstSealTime: string
}

export interface BreadthTick {
    /** HH:MM */
    time: string
    up: number
    down: number
}

export interface LimitDownStock {
    code: string
    name: string
    price: number
    changePercent: number
    /** 连续跌停天数：1=首次跌停 */
    days: number
    industry: string
    /** 跌停板上的卖单封单金额（元），越大说明抛压越重 */
    sealFund: number
    /** 盘中打开跌停的次数（撬板），多说明有资金在抄底 */
    openCount: number
    /** 最后一次封跌停时间 HH:MM */
    lastSealTime: string
}

export interface BrokenBoardStock {
    code: string
    name: string
    price: number
    changePercent: number
    /** 盘中最大振幅 % */
    amplitude: number
    /** 炸板次数 */
    breakCount: number
    industry: string
    /** 首次触及涨停时间 HH:MM */
    firstSealTime: string
}

export interface MarketBreadth {
    /** 两个数据源都失败时为 null */
    up: number | null
    down: number | null
    /** 平盘家数，选股宝源不提供，为 null */
    flat: number | null
    /** 全天涨跌家数分时序列（仅选股宝源提供） */
    intraday: BreadthTick[]
    limitUp: number
    limitDown: number
    /** 炸板：盘中触及涨停但收盘没封住 */
    brokenBoard: number
    /** 封板率 = 涨停 / (涨停 + 炸板)，衡量打板资金的成功率 */
    sealRate: number | null
    /** 连板梯队：按连板数从高到低 */
    ladder: Array<{ boards: number; stocks: LimitUpStock[] }>
    /** 跌停梯队：按连续跌停天数从高到低，同层按封单金额从大到小 */
    limitDownLadder: Array<{ days: number; stocks: LimitDownStock[] }>
    /** 炸板股：按当前涨跌幅从低到高（回落越深越靠前） */
    brokenStocks: BrokenBoardStock[]
    /** 数据所属交易日 YYYY-MM-DD（非交易日时为最近一个交易日） */
    tradeDate: string | null
}

function shanghaiDate(offsetDays = 0): string {
    const d = new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 86400 * 1000)
    return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function formatSealTime(fbt: unknown): string {
    const s = String(fbt ?? '').padStart(6, '0')
    return /^\d{6}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : ''
}

type PoolKind = 'ZT' | 'DT' | 'ZB'

async function fetchPool(
    kind: PoolKind,
    date: string
): Promise<{ total: number; pool: Array<Record<string, unknown>> }> {
    const resp = await axios.get(`https://push2ex.eastmoney.com/getTopic${kind}Pool`, {
        params: {
            ut: '7eea3edcaed734bea9cbfc24409ed989',
            dpt: 'wz.ztzt',
            Pageindex: 0,
            pagesize: 500,
            sort: kind === 'DT' ? 'fund:asc' : 'fbt:asc',
            date,
        },
        timeout: 6000,
        headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/ztb/' },
    })
    const data = resp.data?.data
    return { total: Number(data?.tc ?? 0), pool: Array.isArray(data?.pool) ? data.pool : [] }
}

type BreadthCounts = Pick<MarketBreadth, 'up' | 'down' | 'flat'> & { intraday: BreadthTick[] }

/** 题材池价格字段是「元 × 1000」的整数 */
function poolPrice(p: unknown): number {
    const v = Number(p)
    return Number.isFinite(v) ? v / 1000 : 0
}

function num(v: unknown): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

/** 解析东财跌停池，按连续跌停天数分层。 */
export function parseLimitDownPool(pool: Array<Record<string, unknown>>): MarketBreadth['limitDownLadder'] {
    const byDays = new Map<number, LimitDownStock[]>()
    for (const p of pool) {
        const stock: LimitDownStock = {
            code: String(p.c),
            name: String(p.n),
            price: poolPrice(p.p),
            changePercent: num(p.zdp),
            days: Number(p.days) || 1,
            industry: String(p.hybk ?? ''),
            sealFund: num(p.fund),
            openCount: num(p.oc),
            lastSealTime: formatSealTime(p.lbt),
        }
        const arr = byDays.get(stock.days) ?? []
        arr.push(stock)
        byDays.set(stock.days, arr)
    }
    return [...byDays.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([days, stocks]) => ({ days, stocks: stocks.sort((a, b) => b.sealFund - a.sealFund) }))
}

/** 解析东财炸板池，回落最深的排在前面。 */
export function parseBrokenBoardPool(pool: Array<Record<string, unknown>>): BrokenBoardStock[] {
    return pool
        .map((p) => ({
            code: String(p.c),
            name: String(p.n),
            price: poolPrice(p.p),
            changePercent: num(p.zdp),
            amplitude: num(p.zf),
            breakCount: num(p.zbc) || 1,
            industry: String(p.hybk ?? ''),
            firstSealTime: formatSealTime(p.fbt),
        }))
        .sort((a, b) => a.changePercent - b.changePercent)
}

async function fetchBreadthFromEastmoney(): Promise<BreadthCounts> {
    const resp = await withPush2(() =>
        axios.get('https://push2.eastmoney.com/api/qt/ulist.np/get', {
            params: { fltt: 2, secids: '1.000001,0.399001', fields: 'f12,f104,f105,f106' },
            timeout: 5000,
            headers: EM_HEADERS,
        })
    )
    const list: Array<Record<string, number>> = resp.data?.data?.diff ?? []
    if (list.length === 0) throw new Error('eastmoney: empty breadth')
    let up = 0
    let down = 0
    let flat = 0
    for (const d of list) {
        up += d.f104 || 0
        down += d.f105 || 0
        flat += d.f106 || 0
    }
    return { up, down, flat, intraday: [] }
}

/**
 * 备用源：选股宝全市场涨跌家数分时序列。
 * 东财 push2 在部分网络环境下会直接断开连接，这里既做兜底，也顺带拿到全天曲线。
 */
async function fetchBreadthFromXuangubao(): Promise<BreadthCounts> {
    const resp = await axios.get('https://flash-api.xuangubao.cn/api/market_indicator/line', {
        params: { fields: 'rise_count,fall_count' },
        timeout: 7000,
        headers: { 'User-Agent': UA, Referer: 'https://xuangubao.cn/' },
    })
    const list: Array<{ rise_count: number; fall_count: number; timestamp: number }> = resp.data?.data ?? []
    if (list.length === 0) throw new Error('xuangubao: empty breadth')
    const intraday = list.map((d) => ({
        time: new Date((d.timestamp + 8 * 3600) * 1000).toISOString().slice(11, 16),
        up: d.rise_count,
        down: d.fall_count,
    }))
    const last = intraday[intraday.length - 1]
    return { up: last.up, down: last.down, flat: null, intraday }
}

async function fetchBreadthCounts(): Promise<BreadthCounts> {
    try {
        return await fetchBreadthFromEastmoney()
    } catch {
        return fetchBreadthFromXuangubao()
    }
}

export const fetchMarketBreadth = cached(30_000, async (): Promise<MarketBreadth> => {
    const countsPromise = fetchBreadthCounts().catch(() => ({ up: null, down: null, flat: null, intraday: [] }))

    let tradeDate: string | null = null
    let zt: Awaited<ReturnType<typeof fetchPool>> = { total: 0, pool: [] }
    // 周末/节假日题材池为空，最多回溯 10 天找到最近交易日
    for (let offset = 0; offset < 10; offset++) {
        const date = shanghaiDate(offset)
        try {
            zt = await fetchPool('ZT', date)
        } catch {
            break
        }
        if (zt.total > 0) {
            tradeDate = date
            break
        }
    }

    let limitDown = 0
    let brokenBoard = 0
    let limitDownLadder: MarketBreadth['limitDownLadder'] = []
    let brokenStocks: BrokenBoardStock[] = []
    if (tradeDate) {
        const [dt, zb] = await Promise.allSettled([fetchPool('DT', tradeDate), fetchPool('ZB', tradeDate)])
        if (dt.status === 'fulfilled') {
            limitDown = dt.value.total
            limitDownLadder = parseLimitDownPool(dt.value.pool)
        }
        if (zb.status === 'fulfilled') {
            brokenBoard = zb.value.total
            brokenStocks = parseBrokenBoardPool(zb.value.pool)
        }
    }

    const byBoards = new Map<number, LimitUpStock[]>()
    for (const p of zt.pool) {
        const stock: LimitUpStock = {
            code: String(p.c),
            name: String(p.n),
            boards: Number(p.lbc) || 1,
            industry: String(p.hybk ?? ''),
            firstSealTime: formatSealTime(p.fbt),
        }
        const arr = byBoards.get(stock.boards) ?? []
        arr.push(stock)
        byBoards.set(stock.boards, arr)
    }
    const ladder = [...byBoards.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([boards, stocks]) => ({ boards, stocks }))

    const limitUp = zt.total
    return {
        ...(await countsPromise),
        limitUp,
        limitDown,
        brokenBoard,
        sealRate: limitUp + brokenBoard > 0 ? (limitUp / (limitUp + brokenBoard)) * 100 : null,
        ladder,
        limitDownLadder,
        brokenStocks,
        tradeDate: tradeDate ? `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6)}` : null,
    }
})

// ─── 行业板块热力图 ──────────────────────────────────────────────────────

export interface SectorHeatItem {
    code: string
    name: string
    changePercent: number
    /** 成交额（元） */
    amount: number
    /** 领涨股 */
    leader: string
    /** 新浪备用源没有涨跌家数，为 null */
    upCount: number | null
    downCount: number | null
}

async function fetchSectorHeatmapFromEastmoney(topN: number): Promise<SectorHeatItem[]> {
    // fs 含 + 号，axios params 会编码成 %2B 导致被拒，手动拼 URL
    const qs = `pn=1&pz=${topN}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f6&fs=m:90+t:2&fields=f3,f6,f12,f14,f104,f105,f128`
    const resp = await withPush2(() =>
        axios.get(`https://push2.eastmoney.com/api/qt/clist/get?${qs}`, {
            timeout: 5000,
            headers: EM_HEADERS,
        })
    )
    const list: Array<Record<string, unknown>> = resp.data?.data?.diff ?? []
    const result = list
        .filter((d) => typeof d.f3 === 'number' && typeof d.f6 === 'number')
        .map((d) => ({
            code: String(d.f12),
            name: String(d.f14),
            changePercent: d.f3 as number,
            amount: d.f6 as number,
            leader: String(d.f128 ?? ''),
            upCount: Number(d.f104) || 0,
            downCount: Number(d.f105) || 0,
        }))
    if (result.length === 0) throw new Error('eastmoney: empty sectors')
    return result
}

// 新浪行业字段：代码,名称,成分数,均价,涨跌额,涨跌幅,成交量,成交额,领涨代码,领涨涨幅,领涨价,领涨涨跌额,领涨名称
async function fetchSectorHeatmapFromSina(topN: number): Promise<SectorHeatItem[]> {
    const text = await fetchSinaText('https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php')
    const m = text.match(/S_Finance_bankuai_sinaindustry\s*=\s*(\{.*\})/)
    if (!m) return []
    const raw: Record<string, string> = JSON.parse(m[1])
    return Object.values(raw)
        .map((v) => v.split(','))
        .map((p) => ({
            code: p[0],
            name: p[1],
            changePercent: parseFloat(p[5]) || 0,
            amount: parseFloat(p[7]) || 0,
            leader: p[12] ?? '',
            upCount: null,
            downCount: null,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, topN)
}

export const fetchSectorHeatmap = cached(30_000, async (topN: number = 60): Promise<SectorHeatItem[]> => {
    try {
        return await fetchSectorHeatmapFromEastmoney(topN)
    } catch {
        return fetchSectorHeatmapFromSina(topN)
    }
})

// ─── 7x24 快讯 ──────────────────────────────────────────────────────────

export interface NewsFlashItem {
    id: string
    title: string
    digest: string
    time: string
    url: string
}

export const fetchNewsFlash = cached(30_000, async (count: number = 30): Promise<NewsFlashItem[]> => {
    // 旧的 newsapi/kuaixun 接口现在只返回 1 条，改用 7x24 快讯列表接口
    const resp = await axios.get('https://np-weblist.eastmoney.com/comm/web/getFastNewsList', {
        params: { client: 'web', biz: 'web_724', fastColumn: 102, sortEnd: '', pageSize: count, req_trace: Date.now() },
        timeout: 8000,
        headers: { 'User-Agent': UA, Referer: 'https://kuaixun.eastmoney.com/' },
    })
    const list: Array<Record<string, string>> = resp.data?.data?.fastNewsList ?? []
    if (list.length === 0) throw new Error('快讯列表为空')
    return list
        .filter((it) => it.title)
        .map((it) => ({
            id: it.code,
            title: it.title,
            // 摘要以【标题】开头，去掉重复部分
            digest: (it.summary || '').replace(/^【[^】]*】/, '').trim(),
            time: it.showTime || '',
            url: `https://finance.eastmoney.com/a/${it.code}.html`,
        }))
})
