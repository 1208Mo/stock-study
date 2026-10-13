import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { useHoldingsStore } from '../stores/holdingsStore'
import { usePolling, APP_REFRESH_EVENT } from '../utils/usePolling'
import { useChartTheme, type ChartTheme } from '../utils/chartTheme'
import { Tooltip } from '../components/Tooltip'
import { IconRefresh } from '../components/Icons'
import { stockRoute } from '../utils/routes'
import type { MarketBreadth, MarketRegime, NewsFlashItem, SectorHeatItem } from '../types'

const REGIME_META: Record<MarketRegime['regime'], { label: string; cls: string; hint: string }> = {
    offensive: { label: '偏强', cls: 'up', hint: '指数站上均线且放量，市场偏进攻' },
    defensive: { label: '震荡', cls: 'neutral', hint: '方向不明或缩量，控制仓位、精选个股' },
    cash: { label: '偏弱', cls: 'down', hint: '指数破位下跌，以防守为主' },
}

function signed(n: number, digits = 2) {
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
}

function trend(n: number) {
    return n > 0 ? 'up' : n < 0 ? 'down' : ''
}

function formatMoney(n: number) {
    const abs = Math.abs(n)
    if (abs >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
    if (abs >= 1e4) return `${(n / 1e4).toFixed(2)} 万`
    return n.toFixed(2)
}

function hexToRgb(hex: string): [number, number, number] | null {
    const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
    if (!m) return null
    const v = parseInt(m[1], 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** 涨跌幅映射到颜色：±limit 处达到满色，0 附近是中性灰 */
function heatColor(pct: number, theme: ChartTheme, limit = 4): string {
    const neutral = hexToRgb(theme.axisLine) ?? [58, 63, 82]
    const target = hexToRgb(pct >= 0 ? theme.up : theme.down)
    if (!target) return pct >= 0 ? theme.up : theme.down
    const t = Math.min(Math.abs(pct) / limit, 1) * 0.85 + 0.15
    const c = neutral.map((n, i) => Math.round(n + (target[i] - n) * t))
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

interface HeatNode {
    name: string
    value: number
    pct: number
    code: string
    extra: string
}

function buildTreemapOption(nodes: HeatNode[], theme: ChartTheme, valueLabel: string) {
    return {
        tooltip: {
            formatter: (info: { data: HeatNode }) => {
                const d = info.data
                return `<b>${d.name}</b><br/>涨跌幅：${signed(d.pct)}%<br/>${valueLabel}：${formatMoney(d.value)}${d.extra ? `<br/>${d.extra}` : ''}`
            },
        },
        series: [
            {
                type: 'treemap',
                roam: false,
                nodeClick: false,
                breadcrumb: { show: false },
                // 面积太小的方块放不下文字，直接不画，避免挤成一团
                visibleMin: 900,
                width: '100%',
                height: '100%',
                top: 0,
                left: 0,
                label: {
                    show: true,
                    formatter: (p: { data: HeatNode }) => `${p.data.name}\n${signed(p.data.pct)}%`,
                    color: '#fff',
                    fontSize: 12,
                    lineHeight: 16,
                    overflow: 'truncate',
                },
                itemStyle: { borderColor: theme.split, borderWidth: 1, gapWidth: 1 },
                data: nodes.map((n) => ({ ...n, itemStyle: { color: heatColor(n.pct, theme) } })),
            },
        ],
    }
}

function BreadthCard({ data, theme }: { data: MarketBreadth | null; theme: ChartTheme }) {
    if (!data) return <div className="dash-card dash-skeleton" style={{ height: 168 }} />
    const { up, down, flat, intraday } = data
    const hasCounts = up !== null && down !== null
    const total = hasCounts ? up + down + (flat ?? 0) : 0
    const upRatio = hasCounts && total > 0 ? (up / total) * 100 : null
    const mood =
        upRatio === null ? null : upRatio >= 60 ? '赚钱效应强' : upRatio >= 40 ? '赚钱效应一般' : '亏钱效应明显'

    // 涨跌家数分时：上涨为红色面积、下跌为绿色面积，看得出情绪是什么时候转向的
    const trendOption = intraday.length > 1 && {
        grid: { left: 0, right: 0, top: 6, bottom: 0 },
        tooltip: {
            trigger: 'axis',
            formatter: (ps: Array<{ axisValue: string; seriesName: string; value: number }>) =>
                `${ps[0]?.axisValue}<br/>${ps.map((p) => `${p.seriesName} ${p.value}`).join('<br/>')}`,
        },
        xAxis: { type: 'category', data: intraday.map((t) => t.time), show: false, boundaryGap: false },
        yAxis: { type: 'value', show: false },
        series: (['up', 'down'] as const).map((key) => ({
            name: key === 'up' ? '上涨' : '下跌',
            type: 'line',
            showSymbol: false,
            smooth: true,
            data: intraday.map((t) => t[key]),
            lineStyle: { width: 1.5, color: key === 'up' ? theme.up : theme.down },
            areaStyle: { opacity: 0.12, color: key === 'up' ? theme.up : theme.down },
        })),
    }

    return (
        <div className="dash-card">
            <div className="dash-card-header">
                <h3>市场情绪</h3>
                {data.tradeDate && <span className="dash-card-meta">{data.tradeDate}</span>}
            </div>
            {hasCounts ? (
                <>
                    <div className="breadth-numbers">
                        <span className="up">上涨 {up}</span>
                        {flat !== null && <span className="dash-muted">平 {flat}</span>}
                        <span className="down">下跌 {down}</span>
                    </div>
                    <div className="breadth-bar">
                        <div className="breadth-bar-up" style={{ width: `${(up / total) * 100}%` }} />
                        {flat !== null && (
                            <div className="breadth-bar-flat" style={{ width: `${(flat / total) * 100}%` }} />
                        )}
                        <div className="breadth-bar-down" style={{ width: `${(down / total) * 100}%` }} />
                    </div>
                    {mood && (
                        <div className="breadth-mood">
                            {mood} · 上涨占比 {upRatio!.toFixed(0)}%
                        </div>
                    )}
                    {trendOption && (
                        <Tooltip content="全天涨跌家数走势：红线走高说明资金在进场，绿线反超说明情绪转弱">
                            <div className="breadth-trend">
                                <ReactECharts option={trendOption} style={{ height: 56 }} notMerge />
                            </div>
                        </Tooltip>
                    )}
                </>
            ) : (
                <div className="dash-muted breadth-unavailable">涨跌家数暂时获取不到（行情源限流），稍后自动重试</div>
            )}
            <div className="breadth-stats">
                <Tooltip content="当天涨幅达到上限（主板 10%、创业板/科创板 20%）的股票数">
                    <div className="breadth-stat">
                        <span className="breadth-stat-value up">{data.limitUp}</span>
                        <span className="breadth-stat-label">涨停</span>
                    </div>
                </Tooltip>
                <Tooltip content="当天跌幅达到下限的股票数，越多说明恐慌越重">
                    <div className="breadth-stat">
                        <span className="breadth-stat-value down">{data.limitDown}</span>
                        <span className="breadth-stat-label">跌停</span>
                    </div>
                </Tooltip>
                <Tooltip content="盘中摸到涨停、收盘却没封住的股票数，多说明追高资金被套">
                    <div className="breadth-stat">
                        <span className="breadth-stat-value">{data.brokenBoard}</span>
                        <span className="breadth-stat-label">炸板</span>
                    </div>
                </Tooltip>
                <Tooltip content="封板率 = 涨停 ÷（涨停 + 炸板）。高于 70% 说明短线情绪好">
                    <div className="breadth-stat">
                        <span className="breadth-stat-value">
                            {data.sealRate === null ? '—' : `${data.sealRate.toFixed(0)}%`}
                        </span>
                        <span className="breadth-stat-label">封板率</span>
                    </div>
                </Tooltip>
            </div>
        </div>
    )
}

function LadderCard({ data }: { data: MarketBreadth | null }) {
    const navigate = useNavigate()
    const [expanded, setExpanded] = useState(false)
    if (!data) return <div className="dash-card dash-skeleton" style={{ height: 220 }} />

    return (
        <div className="dash-card">
            <div className="dash-card-header">
                <Tooltip content="连续涨停的天数分层。最高板代表当前市场最强的短线龙头">
                    <h3>连板梯队</h3>
                </Tooltip>
                <span className="dash-card-meta">涨停 {data.limitUp} 只</span>
            </div>
            {data.ladder.length === 0 ? (
                <div className="dash-muted">暂无涨停数据</div>
            ) : (
                <div className="ladder-list">
                    {data.ladder.map((level) => {
                        const isFirstBoard = level.boards === 1
                        const shown = isFirstBoard && !expanded ? level.stocks.slice(0, 8) : level.stocks
                        return (
                            <div key={level.boards} className="ladder-row">
                                <span className={`ladder-badge ${level.boards >= 3 ? 'hot' : ''}`}>
                                    {isFirstBoard ? '首板' : `${level.boards}连板`}
                                    <em>{level.stocks.length}</em>
                                </span>
                                <div className="ladder-stocks">
                                    {shown.map((s) => (
                                        <button
                                            key={s.code}
                                            className="ladder-stock"
                                            title={`${s.industry} · 首次封板 ${s.firstSealTime}`}
                                            onClick={() => navigate(stockRoute(s.code, s.name))}
                                        >
                                            {s.name}
                                        </button>
                                    ))}
                                    {isFirstBoard && level.stocks.length > 8 && (
                                        <button className="ladder-more" onClick={() => setExpanded((v) => !v)}>
                                            {expanded ? '收起' : `+${level.stocks.length - 8}`}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function NewsCard({ items, error }: { items: NewsFlashItem[] | null; error: string | null }) {
    const [openId, setOpenId] = useState<string | null>(null)
    return (
        <div className="dash-card news-card">
            <div className="dash-card-header">
                <h3>7×24 快讯</h3>
                <span className="quote-live-dot" title="每分钟自动刷新" />
            </div>
            {!items ? (
                error ? (
                    <div className="dash-muted">快讯加载失败：{error}</div>
                ) : (
                    <div className="dash-skeleton" style={{ height: 300 }} />
                )
            ) : (
                <ul className="news-list">
                    {items.map((n) => {
                        const open = openId === n.id
                        return (
                            <li key={n.id} className={`news-item ${open ? 'open' : ''}`}>
                                <button className="news-head" onClick={() => setOpenId(open ? null : n.id)}>
                                    <span className="news-time">{n.time.slice(11, 16)}</span>
                                    <span className="news-title">{n.title}</span>
                                </button>
                                {open && (
                                    <div className="news-body">
                                        <p>{n.digest || '（无摘要）'}</p>
                                        {n.url && (
                                            <a href={n.url} target="_blank" rel="noreferrer">
                                                查看原文 ↗
                                            </a>
                                        )}
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

export default function Dashboard() {
    const navigate = useNavigate()
    const theme = useChartTheme()
    const { holdings, fetchHoldings, refreshQuotes } = useHoldingsStore()
    const [refreshing, setRefreshing] = useState(false)

    const breadth = usePolling<MarketBreadth>(() => window.api.market.getBreadth(), 60_000)
    const sectors = usePolling<SectorHeatItem[]>(() => window.api.market.getSectorHeatmap(40), 60_000)
    const news = usePolling<NewsFlashItem[]>(() => window.api.market.getNewsFlash(40), 60_000)
    const regime = usePolling<MarketRegime>(() => window.api.market.getRegime(), 5 * 60_000)

    // 手动刷新：复用全局 app:refresh 事件，usePolling 与持仓行情都会监听后立即补拉
    const handleRefresh = () => {
        window.dispatchEvent(new Event(APP_REFRESH_EVENT))
        setRefreshing(true)
        window.setTimeout(() => setRefreshing(false), 800)
    }

    useEffect(() => {
        fetchHoldings()
        const timer = setInterval(() => {
            if (!document.hidden) refreshQuotes()
        }, 30_000)
        // Cmd/Ctrl+R 手动刷新：顶部资产卡依赖持仓行情，这里也跟着补拉一次
        const onRefresh = () => refreshQuotes()
        window.addEventListener(APP_REFRESH_EVENT, onRefresh)
        return () => {
            clearInterval(timer)
            window.removeEventListener(APP_REFRESH_EVENT, onRefresh)
        }
    }, [fetchHoldings, refreshQuotes])

    const asset = useMemo(() => {
        let marketValue = 0
        let cost = 0
        let todayPnl = 0
        let prevValue = 0
        for (const h of holdings) {
            const costPrice = h.avg_cost_price ?? h.cost_price
            const price = h.quote?.price ?? costPrice
            marketValue += price * h.quantity
            cost += costPrice * h.quantity
            if (h.quote) {
                todayPnl += h.quote.change * h.quantity
                prevValue += (h.quote.price - h.quote.change) * h.quantity
            }
        }
        const profit = marketValue - cost
        return {
            marketValue,
            profit,
            profitPct: cost > 0 ? (profit / cost) * 100 : 0,
            todayPnl,
            todayPct: prevValue > 0 ? (todayPnl / prevValue) * 100 : 0,
        }
    }, [holdings])

    const sectorOption = useMemo(() => {
        if (!sectors.data?.length) return null
        const nodes: HeatNode[] = sectors.data.map((s) => ({
            name: s.name,
            value: s.amount,
            pct: s.changePercent,
            code: s.code,
            extra: [
                s.leader ? `领涨：${s.leader}` : '',
                s.upCount !== null && s.downCount !== null ? `涨/跌家数：${s.upCount}/${s.downCount}` : '',
            ]
                .filter(Boolean)
                .join('<br/>'),
        }))
        return buildTreemapOption(nodes, theme, '成交额')
    }, [sectors.data, theme])

    const holdingOption = useMemo(() => {
        const nodes: HeatNode[] = holdings
            .filter((h) => h.quote)
            .map((h) => ({
                name: h.name,
                value: h.quote!.price * h.quantity,
                pct: h.quote!.changePercent,
                code: h.code,
                extra: `今日盈亏：${signed(h.quote!.change * h.quantity)} 元`,
            }))
        return nodes.length ? buildTreemapOption(nodes, theme, '持仓市值') : null
    }, [holdings, theme])

    const regimeMeta = regime.data ? REGIME_META[regime.data.regime] : null

    return (
        <div className="page dashboard-page">
            <div className="page-header">
                <h1 className="page-title">市场总览</h1>
                <div className="dash-header-right">
                    <span className="dash-muted">
                        {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}
                    </span>
                    <Tooltip content="立即拉取最新数据（快捷键 ⌘/Ctrl + R）">
                        <button
                            className={`dash-refresh-btn ${refreshing ? 'spinning' : ''}`}
                            onClick={handleRefresh}
                            aria-label="刷新"
                        >
                            <IconRefresh />
                        </button>
                    </Tooltip>
                </div>
            </div>

            <div className="dash-assets">
                <div className="dash-asset-card" onClick={() => navigate('/portfolio')}>
                    <span className="dash-asset-label">持仓市值</span>
                    <span className="dash-asset-value">{holdings.length ? formatMoney(asset.marketValue) : '—'}</span>
                    <span className="dash-asset-sub">{holdings.length} 只股票</span>
                </div>
                <div className={`dash-asset-card accent-${trend(asset.todayPnl) || 'flat'}`}>
                    <span className="dash-asset-label">今日盈亏</span>
                    <span className={`dash-asset-value ${trend(asset.todayPnl)}`}>
                        {holdings.length ? signed(asset.todayPnl) : '—'}
                    </span>
                    <span className={`dash-asset-sub ${trend(asset.todayPct)}`}>
                        {holdings.length ? `${signed(asset.todayPct)}%` : '添加持仓后显示'}
                    </span>
                </div>
                <div className={`dash-asset-card accent-${trend(asset.profit) || 'flat'}`}>
                    <span className="dash-asset-label">持仓盈亏</span>
                    <span className={`dash-asset-value ${trend(asset.profit)}`}>
                        {holdings.length ? signed(asset.profit) : '—'}
                    </span>
                    <span className={`dash-asset-sub ${trend(asset.profitPct)}`}>
                        {holdings.length ? `收益率 ${signed(asset.profitPct)}%` : ''}
                    </span>
                </div>
                <Tooltip content={regime.data?.rationale || regimeMeta?.hint || '根据上证、深证指数的均线和量能判断'}>
                    <div className={`dash-asset-card accent-${regimeMeta?.cls ?? 'flat'}`}>
                        <span className="dash-asset-label">大盘状态</span>
                        <span className={`dash-asset-value ${regimeMeta?.cls ?? ''}`}>
                            {regimeMeta?.label ?? (regime.loading ? '…' : '—')}
                        </span>
                        <span className="dash-asset-sub">{regimeMeta?.hint ?? '规则判断，非预测'}</span>
                    </div>
                </Tooltip>
            </div>

            <div className="dash-grid">
                <div className="dash-main">
                    <BreadthCard data={breadth.data} theme={theme} />

                    <div className="dash-card">
                        <div className="dash-card-header">
                            <h3>行业热力图</h3>
                            <span className="dash-card-meta">方块大小 = 成交额 · 颜色 = 涨跌幅 · 点击进入板块雷达</span>
                        </div>
                        {sectorOption ? (
                            <ReactECharts
                                option={sectorOption}
                                style={{ height: 340 }}
                                notMerge
                                onEvents={{ click: () => navigate('/radar') }}
                            />
                        ) : sectors.error ? (
                            <div className="dash-muted">板块数据加载失败：{sectors.error}</div>
                        ) : (
                            <div className="dash-skeleton" style={{ height: 340 }} />
                        )}
                    </div>

                    <div className="dash-card">
                        <div className="dash-card-header">
                            <h3>我的持仓热力图</h3>
                            <span className="dash-card-meta">方块大小 = 持仓市值 · 颜色 = 今日涨跌</span>
                        </div>
                        {holdingOption ? (
                            <ReactECharts
                                option={holdingOption}
                                style={{ height: 240 }}
                                notMerge
                                onEvents={{
                                    click: (p: { data?: HeatNode }) => p.data && navigate(stockRoute(p.data.code, p.data.name)),
                                }}
                            />
                        ) : (
                            <div className="dash-empty">
                                <span>还没有持仓，或行情还在加载</span>
                                <button className="btn-secondary" onClick={() => navigate('/portfolio')}>
                                    去添加持仓
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="dash-side">
                    <LadderCard data={breadth.data} />
                    <NewsCard items={news.data} error={news.error} />
                </div>
            </div>
        </div>
    )
}
