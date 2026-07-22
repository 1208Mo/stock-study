import cron from 'node-cron'
import { fetchBatchQuotes } from './market'
import { getAllHoldings } from '../db'
import { Notification } from 'electron'

export function startScheduler(): void {
    // 盘前推送 — 工作日 9:25
    cron.schedule(
        '25 9 * * 1-5',
        async () => {
            await sendPreMarketPush()
        },
        { timezone: 'Asia/Shanghai' }
    )

    // 盘中异动检查 — 工作日 9:30-15:00 每5分钟
    cron.schedule(
        '*/5 9-14 * * 1-5',
        async () => {
            await checkAbnormalMovement()
        },
        { timezone: 'Asia/Shanghai' }
    )

    // 盘后总结 — 工作日 15:05
    cron.schedule(
        '5 15 * * 1-5',
        async () => {
            await sendPostMarketSummary()
        },
        { timezone: 'Asia/Shanghai' }
    )

    console.log('Scheduler started')
}

async function sendPreMarketPush(): Promise<void> {
    try {
        const notification = new Notification({
            title: 'StockMind — 开盘提醒',
            body: '距离开盘还有5分钟，今日市场行情即将开始。',
        })
        notification.show()
    } catch (e) {
        console.error('Pre-market push error:', e)
    }
}

async function checkAbnormalMovement(): Promise<void> {
    try {
        const holdings = getAllHoldings() as Array<{ code: string; name: string }>
        if (holdings.length === 0) return

        const codes = holdings.map((h) => h.code)
        const quotes = await fetchBatchQuotes(codes)

        for (const q of quotes) {
            const absChange = Math.abs(q.changePercent)
            if (absChange >= 5) {
                const direction = q.changePercent > 0 ? '上涨' : '下跌'
                const notification = new Notification({
                    title: `${q.name} 异动提醒`,
                    body: `${q.name}(${q.code}) 今日${direction} ${Math.abs(q.changePercent).toFixed(2)}%，当前价 ${q.price} 元`,
                })
                notification.show()
            }
        }
    } catch (e) {
        console.error('Abnormal movement check error:', e)
    }
}

async function sendPostMarketSummary(): Promise<void> {
    try {
        const holdings = getAllHoldings() as Array<{ code: string; name: string }>
        if (holdings.length === 0) return

        const codes = holdings.map((h) => h.code)
        const quotes = await fetchBatchQuotes(codes)

        const gains = quotes.filter((q) => q.changePercent > 0).length
        const loses = quotes.filter((q) => q.changePercent < 0).length

        const notification = new Notification({
            title: 'StockMind — 收盘总结',
            body: `今日持仓：${gains}只上涨，${loses}只下跌，${quotes.length - gains - loses}只平盘`,
        })
        notification.show()
    } catch (e) {
        console.error('Post-market summary error:', e)
    }
}
