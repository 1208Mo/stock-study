import { fetchKLine } from './market'
import type { KLineData } from './market'
import {
    getDecisionById,
    getPendingPickReviews,
    updatePickReview,
    updateDecisionReviewStatus,
    getUnreviewedDecisions,
    type DecisionPickReviewRow,
    type PickReviewResult,
} from '../db'

/** 观察窗口：决策日之后的前 N 个交易日 */
const OBSERVATION_WINDOW = 5
/** 单次定时复盘最多处理的决策数，防止积压打爆行情接口 */
const MAX_REVIEW_DECISIONS_PER_RUN = 10

/** 上海时区当日 'YYYY-MM-DD'，避免 toISOString() 的 UTC 偏移 */
function todayShanghai(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

function emptyResult(): PickReviewResult {
    return {
        status: 'reviewed',
        entry_triggered: 0,
        entry_type: null,
        entry_price: null,
        entry_date: null,
        exit_reason: null,
        exit_price: null,
        exit_date: null,
        return_pct: null,
        pnl_amount: null,
        kline_snapshot: null,
        error_msg: null,
    }
}

/**
 * 复盘单个 pick：拉取决策日后的K线，判定买入/止损/止盈是否触发，算模拟收益。
 *
 * 判定规则：
 * - avoid 标的不参与命中判定（exit_reason='not_applicable'）
 * - 买入价优先 aggressiveEntry，null 则 conservativeEntry，皆 null 则不可判定
 * - 买入触发：窗口内首个 low ≤ 买入价 的交易日，买入价 = 挂单价（保守口径）
 * - 卖出判定：从买入日起逐日遍历，首个触发止损(low≤stopLoss)/止盈(high≥takeProfit)的日为卖出日
 *   - 同日双触发：保守假设止损先到（不夸大命中率）
 *   - 都没触发：窗口末日 close 收盘
 */
export async function reviewPick(
    decisionDate: string,
    pick: DecisionPickReviewRow
): Promise<PickReviewResult> {
    // avoid 不参与命中判定
    if (pick.action === 'avoid') {
        return { ...emptyResult(), exit_reason: 'not_applicable' }
    }

    // 决定有效买入价
    const entryPrice = pick.aggressive_entry ?? pick.conservative_entry
    const entryType: 'aggressive' | 'conservative' | null =
        pick.aggressive_entry !== null
            ? 'aggressive'
            : pick.conservative_entry !== null
              ? 'conservative'
              : null

    // 拉取 K 线：按决策日距今天数动态放大 days，旧决策也能覆盖
    let klines: KLineData[]
    try {
        const daysSince = Math.max(
            0,
            Math.ceil((Date.now() - new Date(decisionDate).getTime()) / 86400000)
        )
        const days = Math.min(250, Math.max(60, daysSince + 10))
        klines = await fetchKLine(pick.code, days)
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ...emptyResult(), status: 'failed', error_msg: `K线拉取失败: ${msg}` }
    }

    // 过滤决策日之后的 K 线，升序排序（对 fetchKLine 返回顺序无关）
    const future = klines
        .filter((k) => k.date > decisionDate)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    if (future.length === 0) {
        return {
            ...emptyResult(),
            status: 'failed',
            error_msg: '决策日之后无K线数据（可能停牌或未复牌）'
        }
    }

    const window = future.slice(0, OBSERVATION_WINDOW)

    // 无买入价位 → 不可判定
    if (entryPrice === null || entryType === null) {
        return {
            ...emptyResult(),
            exit_reason: 'none',
            kline_snapshot: JSON.stringify(window),
            error_msg: '未提供买入价位'
        }
    }

    // 寻找买入触发日
    let entryIdx = -1
    for (let i = 0; i < window.length; i++) {
        if (window[i].low <= entryPrice) {
            entryIdx = i
            break
        }
    }
    if (entryIdx === -1) {
        // 窗口内未触发买入
        return {
            ...emptyResult(),
            exit_reason: 'none',
            return_pct: 0,
            pnl_amount: 0,
            kline_snapshot: JSON.stringify(window)
        }
    }

    const entryDate = window[entryIdx].date
    const buyPrice = entryPrice

    // 从买入日起逐日判定止损/止盈（含买入日当天）
    let exitReason: PickReviewResult['exit_reason'] = 'window_end'
    let exitPrice = window[window.length - 1].close
    let exitDate = window[window.length - 1].date

    for (let i = entryIdx; i < window.length; i++) {
        const k = window[i]
        const hitStop = pick.stop_loss !== null && k.low <= pick.stop_loss
        const hitTake = pick.take_profit !== null && k.high >= pick.take_profit
        if (hitStop && hitTake) {
            // 同日双触发：保守假设止损先到，避免夸大命中率
            exitReason = 'stop_loss'
            exitPrice = pick.stop_loss!
            exitDate = k.date
            break
        } else if (hitStop) {
            exitReason = 'stop_loss'
            exitPrice = pick.stop_loss!
            exitDate = k.date
            break
        } else if (hitTake) {
            exitReason = 'take_profit'
            exitPrice = pick.take_profit!
            exitDate = k.date
            break
        }
    }

    const returnPct = buyPrice > 0 ? ((exitPrice - buyPrice) / buyPrice) * 100 : 0
    const posAmt = pick.position_amount ?? 0
    const pnlAmount = (returnPct / 100) * posAmt

    return {
        status: 'reviewed',
        entry_triggered: 1,
        entry_type: entryType,
        entry_price: Number(buyPrice.toFixed(4)),
        entry_date: entryDate,
        exit_reason: exitReason,
        exit_price: Number(exitPrice.toFixed(4)),
        exit_date: exitDate,
        return_pct: Number(returnPct.toFixed(2)),
        pnl_amount: Number(pnlAmount.toFixed(2)),
        kline_snapshot: JSON.stringify(window),
        error_msg: null,
    }
}

/** 复盘单条决策的所有未完成 pick（picks ≤ 3，可并行） */
export async function reviewDecision(
    decisionId: number
): Promise<{ reviewed: number; failed: number }> {
    const decision = getDecisionById(decisionId)
    if (!decision) return { reviewed: 0, failed: 0 }

    const pending = getPendingPickReviews(decisionId)
    let reviewed = 0
    let failed = 0

    await Promise.all(
        pending.map(async (row) => {
            const result = await reviewPick(decision.decision_date, row)
            updatePickReview(row.id, result, todayShanghai())
            if (result.status === 'reviewed') reviewed++
            else failed++
        })
    )

    updateDecisionReviewStatus(decisionId)
    return { reviewed, failed }
}

/** 定时任务入口：复盘所有未完成且 decision_date < 今天 的决策（决策间串行） */
export async function runPendingDecisionReviews(): Promise<{
    decisions: number
    reviewed: number
    failed: number
}> {
    const today = todayShanghai()
    const pending = getUnreviewedDecisions(today)
    const toReview = pending.slice(0, MAX_REVIEW_DECISIONS_PER_RUN)

    let reviewed = 0
    let failed = 0
    for (const d of toReview) {
        const r = await reviewDecision(d.id)
        reviewed += r.reviewed
        failed += r.failed
    }
    return { decisions: toReview.length, reviewed, failed }
}
