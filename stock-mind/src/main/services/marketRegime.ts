/**
 * 市场状态判断（marketRegime）
 *
 * 纯规则（非 LLM）的大盘指标计算，作为每日决策 Agent 的客观参考（不做硬约束）。
 * 用上证/创业板指数趋势、MA5/MA20 均线、量能等客观指标给出描述性标签：
 *   - offensive（偏强）：多头排列 + 放量 + 5日正收益
 *   - defensive（震荡）：默认态 / 震荡 / 缩量
 *   - cash（偏弱）：破位下跌
 * 标签只用于展示与提示词背景，仓位和取舍交给 AI 综合判断。
 *
 * 设计要点：
 * 1. 不能复用 fetchKLine —— 其 getSinaSymbol 用 /^[569]/ 判沪深，会把上证指数
 *    '000001' 错映射成 'sz000001'（实为平安银行股票）。本模块直传 'sh000001'。
 * 2. 数据源失败降级到 defensive，不阻塞决策图。
 * 3. 判定优先级：先 cash（最严）→ 再 offensive（最严苛乐观）→ 否则 defensive。
 */

import axios from 'axios'
import type { KLineData } from './market'
import { fetchMarketFlowSnapshot } from './capitalFlow'

const SINA_KLINE_URL =
    'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'

export type MarketRegimeType = 'offensive' | 'defensive' | 'cash'

export interface IndexIndicators {
    name: string
    code: string
    price: number | null
    todayChangePct: number | null
    ma5: number | null
    ma20: number | null
    aboveMa20: boolean | null
    ma5AboveMa20: boolean | null
    ret5d: number | null
    ret20d: number | null
    volumeRatio: number | null
}

export interface MarketRegime {
    regime: MarketRegimeType
    /** -100 ~ 100，越正越偏进攻，供调试与未来扩展 */
    score: number
    indicators: {
        shIndex: IndexIndicators
        szIndex: IndexIndicators
    }
    rationale: string
}

/**
 * 直连新浪 K 线接口取指数日线。
 * symbol 必须是完整新浪代码：上证 'sh000001'、创业板 'sz399006'、深证 'sz399001'。
 */
export async function fetchIndexKLine(
    sinaSymbol: string,
    days: number = 60
): Promise<KLineData[]> {
    const params = {
        symbol: sinaSymbol,
        scale: 240, // 日线
        datalen: days,
        ma: 'no',
    }
    const resp = await axios.get(SINA_KLINE_URL, { params, timeout: 8000 })
    const list: Array<{
        day: string
        open: string
        high: string
        low: string
        close: string
        volume: string
    }> = resp.data ?? []

    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`指数K线数据为空：${sinaSymbol}`)
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

/** 计算简单移动平均 */
function sma(values: number[], period: number): number | null {
    if (values.length < period) return null
    const slice = values.slice(-period)
    return slice.reduce((a, b) => a + b, 0) / period
}

/** 区间收益率（%）：fromN个交易日前 到 当前 */
function periodReturn(closes: number[], ago: number): number | null {
    if (closes.length <= ago) return null
    const past = closes[closes.length - 1 - ago]
    if (!past || past <= 0) return null
    return ((closes[closes.length - 1] - past) / past) * 100
}

/** 量比 = 当日成交量 / 近 N 日均量 */
function volumeRatio(volumes: number[], period: number = 20): number | null {
    if (volumes.length < period + 1 || volumes.length === 0) return null
    const today = volumes[volumes.length - 1]
    const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period
    if (!avg || avg <= 0) return null
    return today / avg
}

export function buildIndicators(
    name: string,
    code: string,
    klines: KLineData[],
    todayChangePct: number | null
): IndexIndicators {
    if (klines.length === 0) {
        return {
            name,
            code,
            price: null,
            todayChangePct,
            ma5: null,
            ma20: null,
            aboveMa20: null,
            ma5AboveMa20: null,
            ret5d: null,
            ret20d: null,
            volumeRatio: null,
        }
    }
    const closes = klines.map((k) => k.close)
    const volumes = klines.map((k) => k.volume)
    const price = closes[closes.length - 1]
    const ma5 = sma(closes, 5)
    const ma20 = sma(closes, 20)
    const ret5d = periodReturn(closes, 5)
    const ret20d = periodReturn(closes, 20)
    const vr = volumeRatio(volumes, 20)

    return {
        name,
        code,
        price,
        todayChangePct,
        ma5,
        ma20,
        aboveMa20: ma20 !== null ? price > ma20 : null,
        ma5AboveMa20: ma5 !== null && ma20 !== null ? ma5 > ma20 : null,
        ret5d,
        ret20d,
        volumeRatio: vr,
    }
}

function fmtPct(v: number | null, withSign = true): string {
    if (v === null) return '—'
    const sign = withSign && v > 0 ? '+' : ''
    return `${sign}${v.toFixed(2)}%`
}

/**
 * 市场状态主判断。任一数据源失败降级 defensive，不抛错。
 */
export async function assessMarketRegime(): Promise<MarketRegime> {
    // 并发拉取上证K线、创业板K线、三指数当日快照
    const [shKlineRes, szKlineRes, snapshotRes] = await Promise.allSettled([
        fetchIndexKLine('sh000001', 60),
        fetchIndexKLine('sz399006', 60),
        fetchMarketFlowSnapshot(),
    ])

    const shKlines = shKlineRes.status === 'fulfilled' ? shKlineRes.value : []
    const szKlines = szKlineRes.status === 'fulfilled' ? szKlineRes.value : []

    const snapshot =
        snapshotRes.status === 'fulfilled' ? snapshotRes.value : []
    const shSnapshot = snapshot.find((s) => s.code === '000001')
    const szSnapshot = snapshot.find((s) => s.code === '399006')

    const sh = buildIndicators(
        '上证指数',
        '000001',
        shKlines,
        shSnapshot?.changePercent ?? null
    )
    const sz = buildIndicators(
        '创业板指',
        '399006',
        szKlines,
        szSnapshot?.changePercent ?? null
    )

    // 数据全部失败 → 保守 defensive
    if (shKlines.length === 0 && szKlines.length === 0) {
        return {
            regime: 'defensive',
            score: 0,
            indicators: { shIndex: sh, szIndex: sz },
            rationale: '指数K线数据获取失败，无大盘指标可参考。',
        }
    }

    const { regime, score } = classifyRegime(sh)
    return {
        regime,
        score,
        indicators: { shIndex: sh, szIndex: sz },
        rationale: buildRationale(sh, sz),
    }
}

/** 三态判定（纯函数，单测覆盖）。优先级：cash → offensive → defensive */
export function classifyRegime(sh: IndexIndicators): { regime: MarketRegimeType; score: number } {
    const shToday = sh.todayChangePct
    const shAboveMa20 = sh.aboveMa20
    const shMa5AboveMa20 = sh.ma5AboveMa20
    const shRet5d = sh.ret5d

    let regime: MarketRegimeType = 'defensive'
    let score = 0

    // cash：破位下跌（任一）
    const cashByDrop = shToday !== null && shToday <= -2
    const cashByBreakdown =
        shAboveMa20 === false && shRet5d !== null && shRet5d <= -3
    const cashByDowntrend = shAboveMa20 === false && shMa5AboveMa20 === false

    if (cashByDrop || cashByBreakdown || cashByDowntrend) {
        regime = 'cash'
        score = -60
        if (cashByDrop) score -= 20
        if (cashByBreakdown) score -= 15
    } else {
        // offensive：多头排列 + 放量 + 5日正收益（全部满足）
        const offensive =
            shAboveMa20 === true &&
            shMa5AboveMa20 === true &&
            shRet5d !== null &&
            shRet5d > 0 &&
            sh.volumeRatio !== null &&
            sh.volumeRatio >= 1.0

        if (offensive) {
            regime = 'offensive'
            score = 40
            if (shRet5d !== null && shRet5d > 0) score += 10
            if (sh.ret20d !== null && sh.ret20d > 0) score += 10
            if (sh.volumeRatio !== null && sh.volumeRatio >= 1.2) score += 10
        } else {
            // defensive：默认，按偏弱程度扣分
            regime = 'defensive'
            score = 0
            if (shAboveMa20 === false) score -= 20
            if (shMa5AboveMa20 === false) score -= 15
            if (shRet5d !== null && shRet5d < 0) score -= 10
            if (sh.volumeRatio !== null && sh.volumeRatio < 0.8) score -= 10
            if (shAboveMa20 === true && shMa5AboveMa20 === true) score += 15
        }
    }

    score = Math.max(-100, Math.min(100, Math.round(score)))
    return { regime, score }
}

function buildRationale(sh: IndexIndicators, sz: IndexIndicators): string {
    const posText = (above: boolean | null) =>
        above === null ? '（均线数据不足）' : above ? '站上MA20' : '跌破MA20'
    const arrangeText = (ma5Above: boolean | null) =>
        ma5Above === null ? '' : ma5Above ? '、多头排列' : '、空头排列'

    const shPart = `上证 ${sh.todayChangePct !== null ? fmtPct(sh.todayChangePct) : '—'}，${posText(sh.aboveMa20)}${arrangeText(sh.ma5AboveMa20)}，5日 ${fmtPct(sh.ret5d)}，量比 ${sh.volumeRatio !== null ? sh.volumeRatio.toFixed(2) : '—'}`
    const szPart = `创业板 ${sz.todayChangePct !== null ? fmtPct(sz.todayChangePct) : '—'}，5日 ${fmtPct(sz.ret5d)}`

    return `${shPart}；${szPart}。`
}
