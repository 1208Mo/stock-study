/**
 * 条件选股
 *
 * 两段式筛选，兼顾速度和准确：
 * 1. 快照过滤：一次拉全市场（或某板块/自选）实时快照，按估值、涨幅、量比、市值等数值条件过滤，
 *    纯内存计算，5000 多只票不到 1 秒。
 * 2. 形态过滤：对第 1 步的幸存者逐只拉前复权日K判定技术形态（均线多头、放量突破、金叉…）。
 *    这一步要发网络请求，所以按成交额取前 maxScan 只，并发受限，带进度回调和取消。
 *
 * 数据源：东财 clist（字段全，含量比/60日涨幅/行业）优先，被反爬时降级新浪 Market_Center（缺量比等字段，为 null）。
 */

import axios from 'axios'
import { withPush2 } from './dataSource'
import { fetchKLineEx } from './market'
import { evaluatePatterns, PATTERN_MIN_BARS, type PatternHit, type PatternId } from './patterns'

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface StockSnapshot {
    code: string
    name: string
    price: number | null
    changePercent: number | null
    /** 成交额（亿元） */
    amount: number | null
    /** 换手率 % */
    turnover: number | null
    /** 量比：当前成交量 / 过去 5 日同时段均量 */
    volumeRatio: number | null
    /** 市盈率（动态） */
    pe: number | null
    pb: number | null
    /** 总市值 / 流通市值（亿元） */
    totalMv: number | null
    floatMv: number | null
    /** 60 日涨跌幅 % / 年初至今 % */
    change60d: number | null
    changeYtd: number | null
    industry: string
}

export type NumericField = Exclude<keyof StockSnapshot, 'code' | 'name' | 'industry'>

export type Board = 'sh_main' | 'sz_main' | 'cyb' | 'kcb' | 'bj'

export interface ScreenerCriteria {
    scope: { type: 'all' } | { type: 'sector'; code: string; name?: string } | { type: 'codes'; codes: string[] }
    ranges?: Partial<Record<NumericField, { min?: number | null; max?: number | null }>>
    /** 空数组/不传 = 全部板块 */
    boards?: Board[]
    excludeST?: boolean
    /** 剔除停牌/无成交 */
    excludeSuspended?: boolean
    patterns?: PatternId[]
    /** all：全部形态都满足；any：满足任一 */
    patternMode?: 'all' | 'any'
    /** 形态扫描最多扫多少只（按成交额从高到低取） */
    maxScan?: number
    sortBy?: NumericField
    sortDir?: 'asc' | 'desc'
    limit?: number
}

export interface ScreenerRow extends StockSnapshot {
    board: Board
    patternHits: PatternHit[]
}

export interface ScreenerResult {
    rows: ScreenerRow[]
    /** 参与筛选的股票总数 */
    universe: number
    /** 通过数值条件的数量 */
    afterFilter: number
    /** 实际做了形态扫描的数量（被 maxScan 截断时小于 afterFilter） */
    scanned: number
    /** 形态扫描时 K 线拉取失败的数量 */
    scanFailed: number
    source: 'eastmoney' | 'sina'
    truncated: boolean
    cancelled: boolean
    elapsedMs: number
    /** 因当前数据源不提供对应字段而被忽略的过滤条件 */
    ignoredFilters: NumericField[]
}

export function boardOf(code: string): Board {
    if (/^(8|4|92)/.test(code)) return 'bj'
    if (/^68/.test(code)) return 'kcb'
    if (/^3/.test(code)) return 'cyb'
    if (/^[69]/.test(code)) return 'sh_main'
    return 'sz_main'
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const yi = (v: unknown, unit = 1e8): number | null => {
    const n = num(typeof v === 'string' ? parseFloat(v) : v)
    return n === null ? null : n / unit
}

// ─── 快照数据源 ─────────────────────────────────────────────────────────

const EM_FIELDS = 'f2,f3,f6,f8,f9,f10,f12,f14,f20,f21,f23,f24,f25,f100'
const EM_ALL_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'

function mapEm(d: Record<string, unknown>): StockSnapshot {
    return {
        code: String(d.f12),
        name: String(d.f14),
        price: num(d.f2),
        changePercent: num(d.f3),
        amount: yi(d.f6),
        turnover: num(d.f8),
        volumeRatio: num(d.f10),
        pe: num(d.f9),
        pb: num(d.f23),
        totalMv: yi(d.f20),
        floatMv: yi(d.f21),
        change60d: num(d.f24),
        changeYtd: num(d.f25),
        industry: typeof d.f100 === 'string' && d.f100 !== '-' ? d.f100 : '',
    }
}

async function fetchEmPage(fs: string, pn: number): Promise<{ total: number; rows: StockSnapshot[] }> {
    // fs 含 + 号，axios params 会编码成 %2B 被拒，手动拼 URL
    const qs = `pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f6&fs=${fs}&fields=${EM_FIELDS}&ut=bd1d9ddb04089700cf9c27f6f7426281`
    const resp = await withPush2(() =>
        axios.get(`https://push2.eastmoney.com/api/qt/clist/get?${qs}`, {
            timeout: 8000,
            headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
        })
    )
    const data = resp.data?.data
    const diff: Array<Record<string, unknown>> = Array.isArray(data?.diff) ? data.diff : Object.values(data?.diff ?? {})
    return { total: Number(data?.total ?? 0), rows: diff.map(mapEm) }
}

async function fetchAllPages(
    fetchPage: (pn: number) => Promise<{ total: number; rows: StockSnapshot[] }>,
    pageSize: number,
    concurrency: number
): Promise<StockSnapshot[]> {
    const first = await fetchPage(1)
    const pages = Math.min(80, Math.ceil(first.total / pageSize))
    const rest: number[] = []
    for (let p = 2; p <= pages; p++) rest.push(p)
    const out = [...first.rows]
    for (let i = 0; i < rest.length; i += concurrency) {
        const batch = await Promise.all(rest.slice(i, i + concurrency).map((p) => fetchPage(p)))
        for (const b of batch) out.push(...b.rows)
    }
    return out
}

async function fetchSinaPage(node: string, page: number): Promise<StockSnapshot[]> {
    const resp = await axios.get(
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData',
        {
            params: { page, num: 100, sort: 'amount', asc: 0, node, _s_r_a: 'auto' },
            timeout: 8000,
            headers: { 'User-Agent': UA, Referer: 'https://vip.stock.finance.sina.com.cn/' },
        }
    )
    const list: Array<Record<string, unknown>> = Array.isArray(resp.data) ? resp.data : []
    return list.map((d) => {
        const f = (k: string) => num(typeof d[k] === 'string' ? parseFloat(d[k] as string) : d[k])
        return {
            code: String(d.code),
            name: String(d.name),
            price: f('trade'),
            changePercent: f('changepercent'),
            amount: yi(d.amount),
            turnover: f('turnoverratio'),
            volumeRatio: null,
            pe: f('per'),
            pb: f('pb'),
            // 新浪市值单位是万元
            totalMv: yi(d.mktcap, 1e4),
            floatMv: yi(d.nmc, 1e4),
            change60d: null,
            changeYtd: null,
            industry: '',
        }
    })
}

async function fetchSinaAll(): Promise<StockSnapshot[]> {
    const countResp = await axios.get(
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount',
        { params: { node: 'hs_a' }, timeout: 6000, headers: { 'User-Agent': UA } }
    )
    const total = parseInt(String(countResp.data).replace(/"/g, ''), 10) || 5500
    const pages = Math.min(80, Math.ceil(total / 100))
    const out: StockSnapshot[] = []
    for (let p = 1; p <= pages; p += 4) {
        const batch = await Promise.all(
            [p, p + 1, p + 2, p + 3].filter((x) => x <= pages).map((x) => fetchSinaPage('hs_a', x).catch(() => []))
        )
        for (const b of batch) out.push(...b)
    }
    if (out.length === 0) throw new Error('新浪全市场快照为空')
    return out
}

let universeCache: { value: { rows: StockSnapshot[]; source: 'eastmoney' | 'sina' }; expiresAt: number } | null = null

/** 全 A 股实时快照（60 秒缓存，避免反复翻页触发反爬） */
export async function fetchMarketSnapshot(): Promise<{ rows: StockSnapshot[]; source: 'eastmoney' | 'sina' }> {
    if (universeCache && universeCache.expiresAt > Date.now()) return universeCache.value
    let value: { rows: StockSnapshot[]; source: 'eastmoney' | 'sina' }
    try {
        value = { rows: await fetchAllPages((pn) => fetchEmPage(EM_ALL_A, pn), 100, 3), source: 'eastmoney' }
        if (value.rows.length < 1000) throw new Error('eastmoney snapshot too small')
    } catch {
        value = { rows: await fetchSinaAll(), source: 'sina' }
    }
    // 东财分页期间排序会变动，可能出现重复或漏项，按代码去重
    const seen = new Set<string>()
    value.rows = value.rows.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)))
    universeCache = { value, expiresAt: Date.now() + 60_000 }
    return value
}

async function fetchSectorSnapshot(bkCode: string): Promise<{ rows: StockSnapshot[]; source: 'eastmoney' | 'sina' }> {
    if (/^BK\d+$/i.test(bkCode)) {
        try {
            return { rows: await fetchAllPages((pn) => fetchEmPage(`b:${bkCode}`, pn), 100, 2), source: 'eastmoney' }
        } catch {
            // 东财不可用时板块代码无法换算成新浪节点，用全市场快照按行业名兜底
        }
    }
    // 新浪行业节点（如 new_blhy）
    if (!/^BK/i.test(bkCode)) {
        const out: StockSnapshot[] = []
        for (let p = 1; p <= 10; p++) {
            const page = await fetchSinaPage(bkCode, p).catch(() => [])
            out.push(...page)
            if (page.length < 100) break
        }
        if (out.length > 0) return { rows: out, source: 'sina' }
    }
    throw new Error('板块成分股获取失败，请稍后重试或改用全市场范围')
}
// ─── 筛选 ──────────────────────────────────────────────────────────────

/** 各数据源不提供的数值字段：命中这些字段的过滤条件会被跳过并告知用户 */
export const UNSUPPORTED_FIELDS: Record<'eastmoney' | 'sina', NumericField[]> = {
    eastmoney: [],
    // 新浪 Market_Center 没有量比、60 日涨幅、年初至今涨幅
    sina: ['volumeRatio', 'change60d', 'changeYtd'],
}

/** 数值条件过滤（纯函数，单测覆盖）。unsupported 中的字段会被跳过（而非把全部结果判为不满足） */
export function applySnapshotFilters(
    rows: StockSnapshot[],
    c: ScreenerCriteria,
    unsupported: Set<NumericField> = new Set()
): StockSnapshot[] {
    const ranges = Object.entries(c.ranges ?? {}) as Array<[NumericField, { min?: number | null; max?: number | null }]>
    const active = ranges.filter(([f, r]) => !unsupported.has(f) && r && (r.min != null || r.max != null))
    const boards = c.boards?.length ? new Set(c.boards) : null
    return rows.filter((r) => {
        if (c.excludeST && /ST|退/i.test(r.name)) return false
        if (c.excludeSuspended && (!r.price || !r.amount)) return false
        if (boards && !boards.has(boardOf(r.code))) return false
        for (const [field, { min, max }] of active) {
            const v = r[field]
            // 有条件但该字段缺失的，视为不满足，避免把数据缺失的票混进结果
            if (v === null) return false
            if (min != null && v < min) return false
            if (max != null && v > max) return false
        }
        return true
    })
}

export function sortRows<T extends StockSnapshot>(rows: T[], by: NumericField = 'amount', dir: 'asc' | 'desc' = 'desc'): T[] {
    const sign = dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
        const [x, y] = [a[by], b[by]]
        if (x === null && y === null) return 0
        if (x === null) return 1
        if (y === null) return -1
        return (x - y) * sign
    })
}

const cancelled = new Set<string>()

export function cancelScreener(requestId: string): void {
    cancelled.add(requestId)
}

export async function runScreener(
    criteria: ScreenerCriteria,
    options: { requestId?: string; onProgress?: (p: { done: number; total: number; hits: number }) => void } = {}
): Promise<ScreenerResult> {
    const started = Date.now()
    const { requestId, onProgress } = options
    const scope = criteria.scope ?? { type: 'all' }

    let snapshot: { rows: StockSnapshot[]; source: 'eastmoney' | 'sina' }
    if (scope.type === 'sector') {
        snapshot = await fetchSectorSnapshot(scope.code)
    } else {
        snapshot = await fetchMarketSnapshot()
        if (scope.type === 'codes') {
            const set = new Set(scope.codes)
            snapshot = { ...snapshot, rows: snapshot.rows.filter((r) => set.has(r.code)) }
        }
    }

    // 当前数据源不支持的字段：过滤时跳过，并把被忽略的条件告知用户
    const unsupported = new Set(UNSUPPORTED_FIELDS[snapshot.source])
    const ignoredFilters = (Object.entries(criteria.ranges ?? {}) as Array<[NumericField, { min?: number | null; max?: number | null }]>)
        .filter(([f, r]) => unsupported.has(f) && r && (r.min != null || r.max != null))
        .map(([f]) => f)

    const filtered = applySnapshotFilters(snapshot.rows, criteria, unsupported)
    const patterns = criteria.patterns ?? []
    const limit = Math.max(1, Math.min(500, criteria.limit ?? 100))
    // 排序字段若当前源不支持，退回按成交额排
    const sortBy = criteria.sortBy && unsupported.has(criteria.sortBy) ? 'amount' : criteria.sortBy
    const base: ScreenerResult = {
        rows: [],
        universe: snapshot.rows.length,
        afterFilter: filtered.length,
        scanned: 0,
        scanFailed: 0,
        source: snapshot.source,
        truncated: false,
        cancelled: false,
        elapsedMs: 0,
        ignoredFilters,
    }

    if (patterns.length === 0) {
        const rows = sortRows(filtered, sortBy, criteria.sortDir)
            .slice(0, limit)
            .map((r) => ({ ...r, board: boardOf(r.code), patternHits: [] }))
        return { ...base, rows, truncated: filtered.length > limit, elapsedMs: Date.now() - started }
    }

    // 形态扫描：按成交额从高到低取前 maxScan 只（流动性差的票形态参考价值也低）
    const maxScan = Math.max(10, Math.min(1500, criteria.maxScan ?? 300))
    const toScan = sortRows(filtered, 'amount', 'desc').slice(0, maxScan)
    const mode = criteria.patternMode ?? 'all'
    const hits: ScreenerRow[] = []
    let done = 0
    let failed = 0
    let cursor = 0
    const bars = Math.max(PATTERN_MIN_BARS + 10, 120)

    async function worker(): Promise<void> {
        while (cursor < toScan.length) {
            if (requestId && cancelled.has(requestId)) return
            const row = toScan[cursor++]
            try {
                const { bars: k } = await fetchKLineEx(row.code, 'day', 'qfq', bars)
                const matched = evaluatePatterns(k, patterns)
                const ok = mode === 'all' ? matched.length === patterns.length : matched.length > 0
                if (ok) hits.push({ ...row, board: boardOf(row.code), patternHits: matched })
            } catch {
                failed++
            }
            done++
            if (onProgress && (done % 5 === 0 || done === toScan.length)) {
                onProgress({ done, total: toScan.length, hits: hits.length })
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(6, toScan.length) }, () => worker()))

    const wasCancelled = !!requestId && cancelled.delete(requestId)
    const rows = sortRows(hits, sortBy, criteria.sortDir).slice(0, limit)
    return {
        ...base,
        rows,
        scanned: done,
        scanFailed: failed,
        truncated: filtered.length > toScan.length || hits.length > limit,
        cancelled: wasCancelled,
        elapsedMs: Date.now() - started,
    }
}

// ─── 内置策略模板 ───────────────────────────────────────────────────────

export interface ScreenerPreset {
    id: string
    name: string
    description: string
    criteria: Omit<ScreenerCriteria, 'scope'>
    builtin?: boolean
}

export const BUILTIN_PRESETS: ScreenerPreset[] = [
    {
        id: 'value_bluechip',
        name: '低估值蓝筹',
        description: '市盈率 0~15、市净率 < 2、总市值 > 500 亿。适合找「便宜的大公司」，弹性小但安全边际高。',
        builtin: true,
        criteria: {
            ranges: { pe: { min: 0, max: 15 }, pb: { min: 0, max: 2 }, totalMv: { min: 500 } },
            excludeST: true,
            excludeSuspended: true,
            sortBy: 'totalMv',
        },
    },
    {
        id: 'volume_breakout',
        name: '放量突破',
        description: '当日放量 2 倍以上并创 20 日新高，量比 > 1.5。追踪资金刚刚发力的票，注意别追已经大涨的。',
        builtin: true,
        criteria: {
            ranges: { changePercent: { min: 2, max: 9 }, volumeRatio: { min: 1.5 }, amount: { min: 2 } },
            excludeST: true,
            excludeSuspended: true,
            patterns: ['volume_breakout'],
            sortBy: 'changePercent',
        },
    },
    {
        id: 'trend_strong',
        name: '均线多头强势',
        description: '均线多头排列 + MACD 零轴上方。中期趋势最健康的一批，适合趋势跟随。',
        builtin: true,
        criteria: {
            ranges: { amount: { min: 3 }, totalMv: { min: 50 } },
            excludeST: true,
            excludeSuspended: true,
            patterns: ['ma_bull', 'above_ma60'],
            sortBy: 'change60d',
        },
    },
    {
        id: 'oversold_rebound',
        name: '超跌反弹',
        description: '60 日跌幅超过 20%，出现 KDJ 低位金叉或 MACD 底背离。逆势抄底，仓位要轻、止损要严。',
        builtin: true,
        criteria: {
            ranges: { change60d: { max: -20 }, amount: { min: 1 } },
            excludeST: true,
            excludeSuspended: true,
            patterns: ['kdj_golden_low', 'bottom_divergence', 'td9_buy'],
            patternMode: 'any',
            sortBy: 'change60d',
            sortDir: 'asc',
        },
    },
    {
        id: 'pullback_buy',
        name: '缩量回踩',
        description: '上升趋势中缩量回踩 20 日线不破。强势股的低吸点，比追高的性价比好。',
        builtin: true,
        criteria: {
            ranges: { changePercent: { min: -3, max: 2 }, amount: { min: 2 } },
            excludeST: true,
            excludeSuspended: true,
            patterns: ['pullback_ma20', 'above_ma60'],
            sortBy: 'amount',
        },
    },
    {
        id: 'small_active',
        name: '小盘活跃',
        description: '流通市值 20~100 亿、换手率 5%~20%。股性活跃、波动大，适合短线，也更容易大起大落。',
        builtin: true,
        criteria: {
            ranges: { floatMv: { min: 20, max: 100 }, turnover: { min: 5, max: 20 } },
            excludeST: true,
            excludeSuspended: true,
            sortBy: 'turnover',
        },
    },
    {
        id: 'consolidation',
        name: '窄幅蓄势',
        description: '站上 60 日线且近 10 日窄幅整理、量能收缩。等待突破方向，适合放进监控池盯突破信号。',
        builtin: true,
        criteria: {
            ranges: { amount: { min: 1 } },
            excludeST: true,
            excludeSuspended: true,
            patterns: ['tight_consolidation', 'above_ma60'],
            sortBy: 'amount',
        },
    },
]
