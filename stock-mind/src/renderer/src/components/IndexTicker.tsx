import { useLocation } from 'react-router-dom'
import { usePolling } from '../utils/usePolling'
import type { IndexTick } from '../types'

function trendClass(pct: number) {
    if (pct > 0) return 'up'
    if (pct < 0) return 'down'
    return ''
}

// 聊天页按整屏高度布局，不显示行情条
const HIDDEN_ROUTES = ['/chat']

export default function IndexTicker() {
    const { pathname } = useLocation()
    if (HIDDEN_ROUTES.includes(pathname)) return null
    return <IndexTickerBar />
}

function IndexTickerBar() {
    const { data } = usePolling<IndexTick[]>(() => window.api.market.getIndexTicker(), 10_000)

    if (!data || data.length === 0) {
        return <div className="index-ticker index-ticker-empty">指数行情加载中…</div>
    }

    return (
        <div className="index-ticker">
            {data.map((t) => {
                const cls = trendClass(t.changePercent)
                const sign = t.changePercent > 0 ? '+' : ''
                return (
                    <div key={t.code} className="index-tick">
                        <span className="index-tick-name">{t.name}</span>
                        <span className={`index-tick-price ${cls}`}>{t.price.toFixed(2)}</span>
                        <span className={`index-tick-pct ${cls}`}>
                            {sign}
                            {t.changePercent.toFixed(2)}%
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
