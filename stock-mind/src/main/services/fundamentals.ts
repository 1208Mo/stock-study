/**
 * 个股基本面数据（get_fundamentals）
 *
 * 数据源：东方财富 datacenter 接口 RPT_F10_FINANCE_MAINFINADATA（主要财务指标）。
 * 注意：datacenter 的 reportName 会随时间废弃失效（分红接口就踩过 RPT_SHAREHOLDER_ALLOTMENT
 * 失效的坑）。若接口返回空或"报表配置不存在"，优先排查 reportName 是否已废弃。
 * 字段名集中常量化在 FIN_COLUMNS，便于一处维护。
 *
 * PE/PB 不依赖第二个接口，用现价/BPS、现价/最新年报EPS 自算（现价复用 fetchQuote），
 * 比再调一个行情接口更稳。
 */

import axios from 'axios'
import { fetchQuote } from './market'

const DC_URL = 'https://datacenter.eastmoney.com/api/data/v1/get'
// 字段名集中声明，便于 reportName/字段失效时一处修改
const FIN_REPORT_NAME = 'RPT_F10_FINANCE_MAINFINADATA'
const FIN_COLUMNS = [
    'REPORT_DATE',
    'REPORT_TYPE',
    'EPSJB', // 基本每股收益
    'BPS', // 每股净资产
    'MGJYXJJE', // 每股经营现金流
    'TOTALOPERATEREVE', // 营业总收入(元)
    'PARENTNETPROFIT', // 归母净利润(元)
    'MLR', // 毛利润(元)
    'TOTALOPERATEREVETZ', // 营收同比(%)
    'PARENTNETPROFITTZ', // 归母净利同比(%)
    'ROEJQ', // 加权净资产收益率(%)
    'XSMLL', // 销售毛利率(%)
    'XSJLL', // 销售净利率(%)
    'ZCFZL', // 资产负债率(%)
].join(',')

interface FinRawRow {
    REPORT_DATE: string | null
    REPORT_TYPE: string | null
    EPSJB: number | null
    BPS: number | null
    MGJYXJJE: number | null
    TOTALOPERATEREVE: number | null
    PARENTNETPROFIT: number | null
    MLR: number | null
    TOTALOPERATEREVETZ: number | null
    PARENTNETPROFITTZ: number | null
    ROEJQ: number | null
    XSMLL: number | null
    XSJLL: number | null
    ZCFZL: number | null
}

export interface FundamentalsHistoryItem {
    reportDate: string
    reportType: string
    roe: number | null
    grossMargin: number | null
    netMargin: number | null
    revenueYoy: number | null
    profitYoy: number | null
}

export interface StockFundamentals {
    code: string
    name: string
    price: number | null
    reportDate: string | null // 最新报告期 YYYY-MM-DD
    reportType: string | null // 一季报/中报/前三季报/年报
    // 估值
    pe: number | null // 现价 / 最新年报EPS
    peEpsYear: string | null // PE 所基于年报年份
    pb: number | null // 现价 / BPS
    // 盈利能力
    roe: number | null // 加权ROE %
    grossMargin: number | null // 毛利率 %
    netMargin: number | null // 净利率 %
    // 成长性
    revenueYoy: number | null // 营收同比 %
    profitYoy: number | null // 净利同比 %
    // 规模（亿元）
    revenueYi: number | null
    netProfitYi: number | null
    // 每股
    eps: number | null
    bps: number | null
    opCashFlowPerShare: number | null
    // 质量
    debtRatio: number | null // 资产负债率 %
    // 近几期趋势
    history: FundamentalsHistoryItem[]
    fetchedAt: string
}

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isFinite(n) ? n : null
}

function toYi(yuan: number | null): number | null {
    if (yuan === null) return null
    return yuan / 1e8
}

function emptyResult(code: string): StockFundamentals {
    return {
        code,
        name: '',
        price: null,
        reportDate: null,
        reportType: null,
        pe: null,
        peEpsYear: null,
        pb: null,
        roe: null,
        grossMargin: null,
        netMargin: null,
        revenueYoy: null,
        profitYoy: null,
        revenueYi: null,
        netProfitYi: null,
        eps: null,
        bps: null,
        opCashFlowPerShare: null,
        debtRatio: null,
        history: [],
        fetchedAt: new Date().toISOString(),
    }
}

async function fetchFinRows(code: string): Promise<FinRawRow[]> {
    const params = {
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1',
        pageSize: 8,
        pageNumber: 1,
        reportName: FIN_REPORT_NAME,
        columns: FIN_COLUMNS,
        filter: `(SECURITY_CODE="${code}")`,
        source: 'HSF',
        client: 'PC',
    }
    const resp = await axios.get(DC_URL, { params, timeout: 6000 })
    const rows: FinRawRow[] = resp.data?.result?.data ?? []
    return Array.isArray(rows) ? rows : []
}

/**
 * 查询个股基本面。任一数据源失败对应字段返回 null，不抛错。
 */
export async function fetchFundamentals(code: string): Promise<StockFundamentals> {
    const cleanCode = code.trim()
    const base = emptyResult(cleanCode)

    const [finRes, quoteRes] = await Promise.allSettled([
        fetchFinRows(cleanCode),
        fetchQuote(cleanCode),
    ])

    if (quoteRes.status === 'fulfilled') {
        base.price = quoteRes.value.price
        base.name = quoteRes.value.name
    }

    if (finRes.status !== 'fulfilled') {
        return base
    }
    const rows = finRes.value
    if (rows.length === 0) {
        return base
    }

    const latest = rows[0]
    base.reportDate = (latest.REPORT_DATE ?? '').slice(0, 10)
    base.reportType = latest.REPORT_TYPE ?? null
    base.eps = num(latest.EPSJB)
    base.bps = num(latest.BPS)
    base.opCashFlowPerShare = num(latest.MGJYXJJE)
    base.roe = num(latest.ROEJQ)
    base.grossMargin = num(latest.XSMLL)
    base.netMargin = num(latest.XSJLL)
    base.revenueYoy = num(latest.TOTALOPERATEREVETZ)
    base.profitYoy = num(latest.PARENTNETPROFITTZ)
    base.revenueYi = toYi(num(latest.TOTALOPERATEREVE))
    base.netProfitYi = toYi(num(latest.PARENTNETPROFIT))
    base.debtRatio = num(latest.ZCFZL)

    // PB = 现价 / BPS
    if (base.price !== null && base.bps !== null && base.bps > 0) {
        base.pb = base.price / base.bps
    }

    // PE = 现价 / 最新年报 EPS（从近8期里找 REPORT_TYPE 含"年报"的最近一条）
    const annual = rows.find((r) => (r.REPORT_TYPE ?? '').includes('年报'))
    if (annual) {
        const annualEps = num(annual.EPSJB)
        base.peEpsYear = (annual.REPORT_DATE ?? '').slice(0, 4)
        if (base.price !== null && annualEps !== null && annualEps > 0) {
            base.pe = base.price / annualEps
        }
    }

    // 近4期趋势（不含最新期本身，取之前的，供 AI 看方向）
    base.history = rows.slice(1, 5).map((r) => ({
        reportDate: (r.REPORT_DATE ?? '').slice(0, 10),
        reportType: r.REPORT_TYPE ?? '',
        roe: num(r.ROEJQ),
        grossMargin: num(r.XSMLL),
        netMargin: num(r.XSJLL),
        revenueYoy: num(r.TOTALOPERATEREVETZ),
        profitYoy: num(r.PARENTNETPROFITTZ),
    }))

    return base
}

/**
 * 将基本面压缩成单行摘要，供决策 Agent prompt 注入。
 * 例：600519 贵州茅台 | PE 22.1(2025年报) PB 7.3 | ROE 10.6% 毛利率89.8% 净利率52.2% | 营收+6.3% 净利+1.5% | 资产负债率12.1%
 */
export function fundamentalsToCompactLine(f: StockFundamentals): string {
    const pct = (v: number | null, sign = true) => {
        if (v === null) return '—'
        const s = sign && v > 0 ? '+' : ''
        return `${s}${v.toFixed(1)}%`
    }
    const fixed = (v: number | null, d = 1) => (v === null ? '—' : v.toFixed(d))
    const pePart = f.pe !== null
        ? `PE ${fixed(f.pe)}${f.peEpsYear ? `(${f.peEpsYear}年报)` : ''}`
        : 'PE —'
    return `${f.code} ${f.name || ''} | ${pePart} PB ${fixed(f.pb)} | ROE ${pct(f.roe, false)} 毛利率${pct(f.grossMargin, false)} 净利率${pct(f.netMargin, false)} | 营收${pct(f.revenueYoy)} 净利${pct(f.profitYoy)} | 资产负债率${pct(f.debtRatio, false)}`
}
