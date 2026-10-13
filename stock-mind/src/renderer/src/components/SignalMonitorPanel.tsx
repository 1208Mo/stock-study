import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import StockPicker from './StockPicker'
import { useAlertsStore } from '../stores/alertsStore'
import type { KLinePeriod, SignalDefaults, SignalEvent, SignalMeta, SignalStats, SignalWatch } from '../types'

const PERIOD_TEXT: Record<string, string> = { '5m': '5分', '15m': '15分', '30m': '30分', '60m': '60分', day: '日K', week: '周K' }
const RANGES: Array<{ days: number | null; label: string }> = [
    { days: 1, label: '今日' },
    { days: 3, label: '3日' },
    { days: 5, label: '5日' },
    { days: 10, label: '10日' },
    { days: 20, label: '20日' },
    { days: 60, label: '60日' },
    { days: null, label: '全部' },
]
const PAGE_SIZE = 30

/** N 个自然日前的日期（含今天算 1 天） */
function sinceDate(days: number | null): string | undefined {
    if (!days) return undefined
    const d = new Date(Date.now() - (days - 1) * 86400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const signed = (v: number | null, d = 2) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const tone = (v: number | null) => (v === null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '')

function Chips<T extends string>({
    options,
    value,
    onChange,
    label,
    color,
}: {
    options: T[]
    value: T[]
    onChange: (v: T[]) => void
    label: (v: T) => string
    color?: (v: T) => string
}) {
    return (
        <div className="signal-chips">
            {options.map((o) => (
                <button
                    key={o}
                    className={`signal-chip ${value.includes(o) ? 'active' : ''} ${color?.(o) ?? ''}`}
                    onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}
                >
                    {label(o)}
                </button>
            ))}
        </div>
    )
}

export default function SignalMonitorPanel() {
    const navigate = useNavigate()
    const setSignalUnread = useAlertsStore((s) => s.setSignalUnread)
    const [meta, setMeta] = useState<{ signals: SignalMeta[]; periods: KLinePeriod[] } | null>(null)
    const [defaults, setDefaults] = useState<SignalDefaults | null>(null)
    const [pool, setPool] = useState<SignalWatch[]>([])
    const [editing, setEditing] = useState<number | null>(null)
    const [busy, setBusy] = useState('')
    const [msg, setMsg] = useState('')

    // 流水筛选
    const [keyword, setKeyword] = useState('')
    const [period, setPeriod] = useState('')
    const [direction, setDirection] = useState<'' | 'buy' | 'sell'>('')
    const [range, setRange] = useState<number | null>(5)
    const [page, setPage] = useState(0)
    const [events, setEvents] = useState<{ rows: SignalEvent[]; total: number }>({ rows: [], total: 0 })

    // 收益统计
    const [statsRange, setStatsRange] = useState<number | null>(60)
    const [stats, setStats] = useState<SignalStats | null>(null)
    const [statsStock, setStatsStock] = useState<string | null>(null)

    const signalName = (id: string) => meta?.signals.find((s) => s.id === id)?.name ?? id
    const signalDir = (id: string) => meta?.signals.find((s) => s.id === id)?.direction

    const loadPool = useCallback(() => window.api.signals.listWatch().then(setPool), [])
    const loadEvents = useCallback(() => {
        window.api.signals
            .events({
                keyword: keyword || undefined,
                period: period || undefined,
                direction: direction || undefined,
                since: sinceDate(range),
                limit: PAGE_SIZE,
                offset: page * PAGE_SIZE,
            })
            .then(setEvents)
    }, [keyword, period, direction, range, page])
    const loadStats = useCallback(() => {
        window.api.signals.stats({ since: sinceDate(statsRange) }).then(setStats)
    }, [statsRange])
    useEffect(() => {
        window.api.signals.meta().then((m) => {
            setMeta({ signals: m.signals, periods: m.periods })
            setDefaults(m.defaults)
        })
        loadPool()
        // 进入页面即视为已读
        window.api.signals.markRead().then(() => setSignalUnread(0))
    }, [loadPool, setSignalUnread])

    useEffect(() => loadEvents(), [loadEvents])
    useEffect(() => loadStats(), [loadStats])
    useEffect(() => setPage(0), [keyword, period, direction, range])

    // 后台扫描出新信号 / 回填完成时刷新
    useEffect(
        () =>
            window.api.signals.onChanged(() => {
                loadEvents()
                loadStats()
                loadPool()
                window.api.signals.markRead().then(() => setSignalUnread(0))
            }),
        [loadEvents, loadStats, loadPool, setSignalUnread]
    )

    const flash = (text: string) => {
        setMsg(text)
        setTimeout(() => setMsg(''), 3000)
    }

    async function saveDefaults(patch: Partial<SignalDefaults>) {
        setDefaults(await window.api.signals.setDefaults(patch))
    }

    async function addStocks(items: Array<{ code: string; name: string }>) {
        if (items.length === 0) return
        const added = await window.api.signals.addWatch(items)
        await loadPool()
        flash(added > 0 ? `新增 ${added} 只，正在用最近 120 根K线回填历史信号…` : '都已在监控池中')
    }

    async function importFrom(kind: 'watchlist' | 'holdings') {
        const list = kind === 'watchlist' ? await window.api.watchlist.getAll() : await window.api.holdings.getAll()
        await addStocks(list.map((x) => ({ code: x.code, name: x.name })))
    }

    async function scanNow() {
        setBusy('scan')
        try {
            const r = await window.api.signals.scanNow()
            flash(r.scanned === 0 ? '监控池为空或全部已暂停' : r.fired > 0 ? `扫描 ${r.scanned} 只，新触发 ${r.fired} 个信号` : `扫描 ${r.scanned} 只，暂无新信号`)
            loadEvents()
            loadStats()
        } finally {
            setBusy('')
        }
    }

    async function backfill() {
        setBusy('backfill')
        try {
            await window.api.signals.backfill()
            flash('已用最近 120 根K线重新回填历史信号')
        } finally {
            setBusy('')
        }
    }
    if (!meta || !defaults) return <div className="dash-empty">加载中…</div>

    const signalIds = meta.signals.map((s) => s.id)
    const dirClass = (id: string) => (signalDir(id) === 'buy' ? 'buy' : 'sell')
    const totalPages = Math.max(1, Math.ceil(events.total / PAGE_SIZE))
    const stockSlice = stats?.byStock.find((s) => s.key === statsStock) ?? null
    const trips = (stats?.trips ?? []).filter((t) => !statsStock || t.code === statsStock)

    return (
        <div className="signal-panel">
            <div className="dash-card">
                <div className="dash-card-header">
                    <h3>监控设置</h3>
                    <label className="switch" title={defaults.enabled ? '暂停后台扫描' : '开启后台扫描'}>
                        <input type="checkbox" checked={defaults.enabled} onChange={(e) => saveDefaults({ enabled: e.target.checked })} />
                        <span className="switch-slider" />
                    </label>
                    <span className="dash-card-meta">
                        {defaults.enabled ? '交易时段每 60 秒扫描一次，收盘后补扫日K' : '已暂停后台扫描'}
                    </span>
                    {msg && <span className="screener-toast">{msg}</span>}
                    <button className="btn-small" onClick={scanNow} disabled={!!busy}>
                        {busy === 'scan' ? '扫描中…' : '立即扫描'}
                    </button>
                    <button className="btn-small" onClick={backfill} disabled={!!busy} title="对监控池全部股票用最近 120 根K线重新计算历史信号">
                        {busy === 'backfill' ? '回填中…' : '回填历史'}
                    </button>
                </div>
                <div className="screener-row">
                    <span className="screener-label">默认周期</span>
                    <Chips
                        options={meta.periods}
                        value={defaults.periods}
                        label={(p) => PERIOD_TEXT[p] ?? p}
                        onChange={(v) => v.length > 0 && saveDefaults({ periods: v })}
                    />
                </div>
                <div className="screener-row screener-row-top">
                    <span className="screener-label">默认信号</span>
                    <Chips
                        options={signalIds}
                        value={defaults.signals}
                        label={signalName}
                        color={dirClass}
                        onChange={(v) => v.length > 0 && saveDefaults({ signals: v })}
                    />
                </div>
                <div className="screener-note">
                    红色为买点信号、绿色为卖点信号。盘中按正在走的那根K线判定，收盘前信号可能消失；同一根K线的同一信号只提醒一次。
                    每只股票也可以单独设置周期和信号，不设置则使用这里的默认值。
                </div>
            </div>
            <div className="dash-card">
                <div className="dash-card-header">
                    <h3>
                        监控池 <span className="dash-muted">{pool.length} 只</span>
                    </h3>
                    <button className="btn-small" onClick={() => importFrom('watchlist')}>
                        导入观察列表
                    </button>
                    <button className="btn-small" onClick={() => importFrom('holdings')}>
                        导入持仓
                    </button>
                </div>
                <StockPicker onPick={(s) => addStocks([s])} placeholder="搜索股票加入监控池（也可以在条件选股结果、个股详情页一键加入）" />
                {pool.length === 0 ? (
                    <div className="dash-empty">
                        <span>监控池是空的</span>
                        <span className="dash-muted">加入后，盘中出现金叉、突破、背离等技术信号时会弹通知</span>
                    </div>
                ) : (
                    <div className="signal-pool">
                        {pool.map((w) => {
                            const ownPeriods = splitList(w.periods) as KLinePeriod[]
                            const ownSignals = splitList(w.signals)
                            return (
                                <div key={w.id} className={`signal-pool-row ${w.enabled ? '' : 'disabled'}`}>
                                    <div className="signal-pool-main">
                                        <button className="signal-pool-name" onClick={() => navigate(`/stock/${w.code}?name=${encodeURIComponent(w.name)}`)}>
                                            {w.name} <span className="dash-muted">{w.code}</span>
                                        </button>
                                        <span className="dash-muted">
                                            {(ownPeriods.length ? ownPeriods : defaults.periods).map((p) => PERIOD_TEXT[p] ?? p).join(' / ')}
                                            {' · '}
                                            {ownSignals.length ? `自定义 ${ownSignals.length} 个信号` : '默认信号'}
                                            {w.last_scanned_at && ` · 上次扫描 ${w.last_scanned_at.slice(5, 16)}`}
                                        </span>
                                        <button className="btn-link" onClick={() => setEditing(editing === w.id ? null : w.id)}>
                                            {editing === w.id ? '收起' : '单独设置'}
                                        </button>
                                        <label className="switch" title={w.enabled ? '暂停' : '启用'}>
                                            <input
                                                type="checkbox"
                                                checked={!!w.enabled}
                                                onChange={async (e) => {
                                                    await window.api.signals.updateWatch(w.id, { enabled: e.target.checked })
                                                    loadPool()
                                                }}
                                            />
                                            <span className="switch-slider" />
                                        </label>
                                        <button
                                            className="btn-action btn-delete"
                                            title="移出监控池"
                                            onClick={async () => {
                                                await window.api.signals.removeWatch(w.id)
                                                loadPool()
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                    {editing === w.id && (
                                        <div className="signal-pool-edit">
                                            <div className="screener-row">
                                                <span className="screener-label">周期</span>
                                                <Chips
                                                    options={meta.periods}
                                                    value={ownPeriods}
                                                    label={(p) => PERIOD_TEXT[p] ?? p}
                                                    onChange={async (v) => {
                                                        await window.api.signals.updateWatch(w.id, { periods: v.join(',') })
                                                        loadPool()
                                                    }}
                                                />
                                                <span className="dash-muted">{ownPeriods.length ? '' : '未选 = 用默认'}</span>
                                            </div>
                                            <div className="screener-row screener-row-top">
                                                <span className="screener-label">信号</span>
                                                <Chips
                                                    options={signalIds}
                                                    value={ownSignals}
                                                    label={signalName}
                                                    color={dirClass}
                                                    onChange={async (v) => {
                                                        await window.api.signals.updateWatch(w.id, { signals: v.join(',') })
                                                        loadPool()
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <div className="dash-card">
                <div className="dash-card-header">
                    <h3>
                        信号流水 <span className="dash-muted">{events.total} 条</span>
                    </h3>
                    {events.total > 0 && (
                        <button
                            className="btn-small"
                            onClick={async () => {
                                await window.api.signals.clearEvents()
                                loadEvents()
                                loadStats()
                            }}
                        >
                            清空
                        </button>
                    )}
                </div>
                <div className="screener-row">
                    <input className="input signal-search" placeholder="代码 / 名称" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                    <select className="input screener-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
                        <option value="">全部周期</option>
                        {meta.periods.map((p) => (
                            <option key={p} value={p}>
                                {PERIOD_TEXT[p] ?? p}
                            </option>
                        ))}
                    </select>
                    <select className="input screener-select" value={direction} onChange={(e) => setDirection(e.target.value as '' | 'buy' | 'sell')}>
                        <option value="">买点 + 卖点</option>
                        <option value="buy">只看买点</option>
                        <option value="sell">只看卖点</option>
                    </select>
                    {RANGES.map((r) => (
                        <button key={r.label} className={`btn-day ${range === r.days ? 'active' : ''}`} onClick={() => setRange(r.days)}>
                            {r.label}
                        </button>
                    ))}
                </div>
                {events.rows.length === 0 ? (
                    <div className="dash-empty">这段时间没有信号</div>
                ) : (
                    <div className="screener-table-wrap">
                        <table className="screener-table">
                            <thead>
                                <tr>
                                    <th>K线时间</th>
                                    <th>股票</th>
                                    <th>周期</th>
                                    <th>信号</th>
                                    <th>触发价</th>
                                    <th>说明</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.rows.map((e) => (
                                    <tr
                                        key={e.id}
                                        className="clickable"
                                        title="打开对应周期的K线核对"
                                        onClick={() => navigate(`/stock/${e.code}?name=${encodeURIComponent(e.name)}&period=${e.period}`)}
                                    >
                                        <td>{e.bar_time.slice(5)}</td>
                                        <td>
                                            {e.name} <span className="dash-muted">{e.code}</span>
                                        </td>
                                        <td>{PERIOD_TEXT[e.period] ?? e.period}</td>
                                        <td>
                                            <span className={`signal-tag ${e.direction}`}>{e.signal_name}</span>
                                        </td>
                                        <td>{e.price}</td>
                                        <td className="dash-muted">{e.detail}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {totalPages > 1 && (
                    <div className="signal-pager">
                        <button className="btn-small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                            上一页
                        </button>
                        <span className="dash-muted">
                            {page + 1} / {totalPages}
                        </span>
                        <button className="btn-small" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                            下一页
                        </button>
                    </div>
                )}
            </div>

            <div className="dash-card">
                <div className="dash-card-header">
                    <h3>信号收益统计</h3>
                    <span className="dash-card-meta">同一股票同一周期：空仓遇买点按信号价开仓，持仓遇卖点平仓，不计手续费</span>
                </div>
                <div className="screener-row">
                    {RANGES.filter((r) => r.days !== 1).map((r) => (
                        <button key={r.label} className={`btn-day ${statsRange === r.days ? 'active' : ''}`} onClick={() => setStatsRange(r.days)}>
                            {r.label}
                        </button>
                    ))}
                    {statsStock && (
                        <button className="btn-small" onClick={() => setStatsStock(null)}>
                            查看全部股票
                        </button>
                    )}
                </div>
                {!stats || stats.overall.trades === 0 ? (
                    <div className="dash-empty">
                        <span>还没有可配对的买卖信号</span>
                        <span className="dash-muted">加入监控池会自动回填历史信号；至少要出现一次买点才能开始统计</span>
                    </div>
                ) : (
                    <>
                        <div className="bt-stats">
                            {[stockSlice ?? stats.overall].map((s) => (
                                <StatCells key={s.key} s={s} />
                            ))}
                        </div>
                        {!statsStock && stats.byPeriod.length > 1 && (
                            <div className="signal-period-stats">
                                {stats.byPeriod.map((p) => (
                                    <span key={p.key} className="signal-period-stat">
                                        {p.label}：{p.closed} 笔，胜率 {p.winRate === null ? '—' : `${p.winRate.toFixed(0)}%`}，均收益{' '}
                                        <b className={tone(p.avgReturnPct)}>{signed(p.avgReturnPct)}</b>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="signal-stats-grid">
                            {!statsStock && (
                                <div className="screener-table-wrap">
                                    <table className="screener-table">
                                        <thead>
                                            <tr>
                                                <th>股票</th>
                                                <th>已平仓</th>
                                                <th>胜率</th>
                                                <th>平均收益</th>
                                                <th>累计收益</th>
                                                <th>持仓中</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stats.byStock.map((s) => (
                                                <tr key={s.key} className="clickable" onClick={() => setStatsStock(s.key)} title="查看这只股票的逐笔明细">
                                                    <td>{s.label}</td>
                                                    <td>{s.closed}</td>
                                                    <td>{s.winRate === null ? '—' : `${s.winRate.toFixed(0)}%`}</td>
                                                    <td className={tone(s.avgReturnPct)}>{signed(s.avgReturnPct)}</td>
                                                    <td className={tone(s.cumReturnPct)}>{signed(s.cumReturnPct)}</td>
                                                    <td>{s.open}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div className="screener-table-wrap">
                                <table className="screener-table">
                                    <thead>
                                        <tr>
                                            <th>股票</th>
                                            <th>周期</th>
                                            <th>买点</th>
                                            <th>卖点</th>
                                            <th>收益</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {trips.slice(0, 50).map((t) => (
                                            <tr key={`${t.code}-${t.period}-${t.entryTime}`}>
                                                <td>{t.name}</td>
                                                <td>{PERIOD_TEXT[t.period] ?? t.period}</td>
                                                <td>
                                                    {t.entryTime.slice(5)} @ {t.entryPrice}
                                                </td>
                                                <td>{t.exitTime ? `${t.exitTime.slice(5)} @ ${t.exitPrice}` : <span className="dash-muted">持仓中</span>}</td>
                                                <td className={tone(t.returnPct ?? t.floatingPct)}>
                                                    {t.returnPct !== null ? signed(t.returnPct) : t.floatingPct !== null ? `浮动 ${signed(t.floatingPct)}` : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

function StatCells({ s }: { s: SignalStats['overall'] }) {
    const cells: Array<{ label: string; value: string; cls?: string }> = [
        { label: '配对笔数', value: `${s.trades}` },
        { label: '已平仓', value: `${s.closed}` },
        { label: '胜率', value: s.winRate === null ? '—' : `${s.winRate.toFixed(1)}%` },
        { label: '平均每笔', value: signed(s.avgReturnPct), cls: tone(s.avgReturnPct) },
        { label: '逐笔复利累计', value: signed(s.cumReturnPct), cls: tone(s.cumReturnPct) },
        { label: '持仓中', value: `${s.open}` },
    ]
    return (
        <>
            {cells.map((c) => (
                <div key={c.label} className="bt-stat">
                    <span className="dash-asset-label">{c.label}</span>
                    <span className={`pa-stat-value ${c.cls ?? ''}`}>{c.value}</span>
                </div>
            ))}
        </>
    )
}
