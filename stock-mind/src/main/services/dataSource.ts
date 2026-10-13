/**
 * 数据源健康状态
 *
 * 东方财富 push2 系域名（push2 / push2his）在部分网络环境下会在 TLS 层直接断开连接
 * （curl 可通、Node 不通，属于客户端指纹级拦截），而行情、K线、板块列表都把东财当首选源。
 * 如果每次请求都要先等一次超时再降级新浪，页面会整体慢 1~5 秒。
 *
 * 这里维护一个进程级的可用性状态：
 * - 启动时探测一次；
 * - 判定不可用后，后续调用直接跳过东财、不再等超时；
 * - 每 10 分钟重新探测，网络恢复后自动切回（东财字段比新浪全，能用就用）。
 */

import axios from 'axios'

export type SourceState = 'unknown' | 'ok' | 'down'

const RECHECK_INTERVAL_MS = 10 * 60_000
const PROBE_TIMEOUT_MS = 3500

let state: SourceState = 'unknown'
let lastCheckedAt = 0
let probing: Promise<boolean> | null = null

export class SourceUnavailableError extends Error {
    constructor(source = 'eastmoney push2') {
        super(`${source} 当前不可用，已跳过`)
        this.name = 'SourceUnavailableError'
    }
}

export function getPush2Status(): { state: SourceState; lastCheckedAt: number } {
    return { state, lastCheckedAt }
}

/** 是否是值得重试的网络类错误（连接层问题，而非业务空数据）。 */
export function isRetryableNetworkError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e)
    return /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|EAI_AGAIN|ENOTFOUND|network/i.test(msg)
}

/**
 * 对一次请求做有限次重试：仅对网络类瞬时错误重试，指数退避。
 * 业务错误（空数据、字段缺失等）立即抛出，交由调用方降级，不浪费时间重试。
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
    const retries = opts.retries ?? 2
    const baseDelayMs = opts.baseDelayMs ?? 300
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn()
        } catch (e) {
            lastErr = e
            if (attempt === retries || !isRetryableNetworkError(e)) throw e
            await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt))
        }
    }
    throw lastErr
}

/** 由真实请求结果反馈状态，省掉额外探测 */
export function reportPush2Result(ok: boolean): void {
    // 只在状态真正翻转时记录，避免刷日志
    if (ok && state !== 'ok') {
        console.log('[dataSource] 东财 push2 可用，优先使用东财数据源')
    } else if (!ok && state !== 'down') {
        console.log('[dataSource] 东财 push2 不可用，本次会话降级到新浪等备用源')
    }
    state = ok ? 'ok' : 'down'
    lastCheckedAt = Date.now()
}

export function probePush2(force = false): Promise<boolean> {
    if (!force && state !== 'unknown' && Date.now() - lastCheckedAt < RECHECK_INTERVAL_MS) {
        return Promise.resolve(state === 'ok')
    }
    if (probing) return probing
    probing = axios
        .get('https://push2.eastmoney.com/api/qt/ulist.np/get', {
            params: { fltt: 2, secids: '1.000001', fields: 'f2' },
            timeout: PROBE_TIMEOUT_MS,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Referer: 'https://quote.eastmoney.com/',
            },
        })
        .then((r) => typeof r.data?.data?.diff?.[0]?.f2 === 'number')
        .catch(() => false)
        .then((ok) => {
            reportPush2Result(ok)
            return ok
        })
        .finally(() => {
            probing = null
        })
    return probing
}

/**
 * 包装一次 push2 请求：已知不可用时立刻抛错（调用方据此降级），
 * 可用或未知时正常请求，并把结果反馈给健康状态。
 */
export async function withPush2<T>(fn: () => Promise<T>): Promise<T> {
    if (state === 'down') {
        // 到了重探时间就顺带探一次，恢复后下次调用即可走东财
        if (Date.now() - lastCheckedAt >= RECHECK_INTERVAL_MS) void probePush2()
        throw new SourceUnavailableError()
    }
    try {
        const result = await fn()
        reportPush2Result(true)
        return result
    } catch (e) {
        // 业务层面的空数据不代表域名不可用，只有连接类错误才标记为 down
        if (isRetryableNetworkError(e)) {
            reportPush2Result(false)
        }
        throw e
    }
}

export function startDataSourceMonitor(): void {
    void probePush2(true)
    setInterval(() => void probePush2(true), RECHECK_INTERVAL_MS)
}
