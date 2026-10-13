import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AlertModal from '../components/AlertModal'
import StockPicker from '../components/StockPicker'
import SignalMonitorPanel from '../components/SignalMonitorPanel'
import { useAlertsStore } from '../stores/alertsStore'
import { stockRoute } from '../utils/routes'
import type { AlertEvent, PriceAlert } from '../types'

const KIND_TEXT: Record<PriceAlert['kind'], (t: number) => string> = {
    price_above: (t) => `涨到 ${t} 元`,
    price_below: (t) => `跌到 ${t} 元`,
    pct_above: (t) => `涨幅 ≥ ${t}%`,
    pct_below: (t) => `跌幅 ≥ ${t}%`,
}

export default function Alerts() {
    const [searchParams, setSearchParams] = useSearchParams()
    const tab = searchParams.get('tab') === 'signals' ? 'signals' : 'price'
    const signalUnread = useAlertsStore((s) => s.signalUnread)

    return (
        <div className="page alerts-page">
            <div className="page-header">
                <h1 className="page-title">提醒中心</h1>
                <div className="page-tabs">
                    <button className={`page-tab ${tab === 'price' ? 'active' : ''}`} onClick={() => setSearchParams({})}>
                        价格提醒
                    </button>
                    <button
                        className={`page-tab ${tab === 'signals' ? 'active' : ''}`}
                        onClick={() => setSearchParams({ tab: 'signals' })}
                    >
                        技术信号监控
                        {signalUnread > 0 && tab !== 'signals' && <span className="nav-badge">{signalUnread}</span>}
                    </button>
                </div>
            </div>
            {tab === 'price' ? <PriceAlertsPanel /> : <SignalMonitorPanel />}
        </div>
    )
}

function PriceAlertsPanel() {
    const navigate = useNavigate()
    const setUnread = useAlertsStore((s) => s.setUnread)
    const [alerts, setAlerts] = useState<PriceAlert[]>([])
    const [events, setEvents] = useState<AlertEvent[]>([])
    const [creating, setCreating] = useState<{ code: string; name: string; price?: number } | null>(null)
    const [checking, setChecking] = useState(false)
    const [checkMsg, setCheckMsg] = useState('')

    const load = useCallback(async () => {
        const [a, e] = await Promise.all([window.api.alerts.list(), window.api.alerts.events(100)])
        setAlerts(a)
        setEvents(e)
        await window.api.alerts.markRead()
        setUnread(0)
    }, [setUnread])

    useEffect(() => {
        load()
        return window.api.alerts.onChanged(() => load())
    }, [load])

    const pickStock = async (s: { code: string; name: string }) => {
        const quote = await window.api.market.getQuote(s.code).catch(() => null)
        setCreating({ code: s.code, name: quote?.name || s.name, price: quote?.price })
    }

    const checkNow = async () => {
        setChecking(true)
        setCheckMsg('')
        try {
            const n = await window.api.alerts.checkNow()
            setCheckMsg(n > 0 ? `触发了 ${n} 条提醒` : '当前没有满足条件的提醒')
            await load()
        } finally {
            setChecking(false)
        }
    }

    const active = alerts.filter((a) => a.enabled)
    const inactive = alerts.filter((a) => !a.enabled)

    const renderAlert = (a: PriceAlert) => (
        <div key={a.id} className={`alert-row ${a.enabled ? '' : 'disabled'}`}>
            <div className="alert-row-main" onClick={() => navigate(stockRoute(a.code, a.name))}>
                <div className="alert-row-title">
                    <span className="alert-row-name">{a.name}</span>
                    <span className="dash-muted">{a.code}</span>
                    {a.source === 'ai' && <span className="alert-badge ai">AI 价位</span>}
                    {a.repeat_daily ? <span className="alert-badge">每日</span> : null}
                </div>
                <div className={`alert-row-cond ${a.kind.endsWith('above') ? 'up' : 'down'}`}>
                    {KIND_TEXT[a.kind](a.target)}
                    {a.note && <span className="alert-row-note">｜{a.note}</span>}
                </div>
                {a.last_triggered_at && <div className="dash-muted">上次触发 {a.last_triggered_at}</div>}
            </div>
            <label className="switch" title={a.enabled ? '关闭' : '开启'}>
                <input
                    type="checkbox"
                    checked={!!a.enabled}
                    onChange={async (e) => {
                        await window.api.alerts.setEnabled(a.id, e.target.checked)
                        load()
                    }}
                />
                <span className="switch-slider" />
            </label>
            <button
                className="btn-action btn-delete"
                title="删除"
                onClick={async () => {
                    await window.api.alerts.delete(a.id)
                    load()
                }}
            >
                ×
            </button>
        </div>
    )

    return (
        <>
            <div className="alerts-toolbar">
                {checkMsg && <span className="dash-muted">{checkMsg}</span>}
                <button className="btn-secondary" onClick={checkNow} disabled={checking}>
                    {checking ? '检查中…' : '立即检查一次'}
                </button>
            </div>

            <div className="alerts-grid">
                <div className="dash-card">
                    <div className="dash-card-header">
                        <h3>我的提醒</h3>
                        <span className="dash-card-meta">
                            {active.length} 条生效中 · 交易时段每 20 秒检查
                        </span>
                    </div>
                    <StockPicker onPick={pickStock} placeholder="输入代码或名称，给任意股票设提醒…" />
                    {alerts.length === 0 ? (
                        <div className="dash-empty">
                            <span>还没有提醒</span>
                            <span className="dash-muted">
                                在上方搜索股票，或在个股详情页点「🔔 提醒」，或在 AI 决策卡上一键采纳止损/止盈价
                            </span>
                        </div>
                    ) : (
                        <div className="alert-list">
                            {active.map(renderAlert)}
                            {inactive.length > 0 && <div className="alert-divider">已关闭 / 已触发</div>}
                            {inactive.map(renderAlert)}
                        </div>
                    )}
                </div>

                <div className="dash-card">
                    <div className="dash-card-header">
                        <h3>触发记录</h3>
                        {events.length > 0 && (
                            <button
                                className="btn-small"
                                onClick={async () => {
                                    await window.api.alerts.clearEvents()
                                    load()
                                }}
                            >
                                清空
                            </button>
                        )}
                    </div>
                    {events.length === 0 ? (
                        <div className="dash-empty">暂无触发记录</div>
                    ) : (
                        <ul className="news-list">
                            {events.map((ev) => (
                                <li key={ev.id} className="news-item">
                                    <button className="news-head" onClick={() => navigate(stockRoute(ev.code, ev.name))}>
                                        <span className="news-time">{ev.created_at.slice(5, 16)}</span>
                                        <span className="news-title">{ev.message}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {creating && (
                <AlertModal
                    code={creating.code}
                    name={creating.name}
                    price={creating.price}
                    onClose={() => setCreating(null)}
                    onSaved={load}
                />
            )}
        </>
    )
}
