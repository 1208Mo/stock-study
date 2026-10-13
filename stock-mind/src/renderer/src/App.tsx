import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { HashRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import IndexTicker from './components/IndexTicker'
import CommandPalette, { OPEN_COMMAND_PALETTE } from './components/CommandPalette'
import { APP_REFRESH_EVENT } from './utils/usePolling'
import {
    IconBell,
    IconDashboard,
    IconFilter,
    IconLogo,
    IconPanelLeft,
    IconRadar,
    IconSearch,
    IconSettings,
    IconSparkles,
    IconStar,
    IconWallet,
} from './components/Icons'
import { useAlertsStore } from './stores/alertsStore'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Portfolio = lazy(() => import('./pages/Portfolio'))
const StockDetail = lazy(() => import('./pages/StockDetail'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Settings = lazy(() => import('./pages/Settings'))
const RealtimeChart = lazy(() => import('./pages/RealtimeChart'))
const AIChat = lazy(() => import('./pages/AIChat'))
const SectorRadar = lazy(() => import('./pages/SectorRadar'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Screener = lazy(() => import('./pages/Screener'))

const NAV: Array<{ to: string; label: string; icon: ComponentType; end?: boolean; title?: string }> = [
    { to: '/', label: '市场总览', icon: IconDashboard, end: true },
    { to: '/portfolio', label: '持仓管理', icon: IconWallet },
    { to: '/watchlist', label: '观察列表', icon: IconStar },
    { to: '/screener', label: '条件选股', icon: IconFilter, title: '按估值/涨幅/量比等条件 + 技术形态筛选全市场' },
    { to: '/radar', label: '板块雷达', icon: IconRadar },
    { to: '/chat', label: '小墨鱼 AI', icon: IconSparkles, title: 'AI 投研助手：对话问答 + 每日计划 + 战绩追踪' },
    { to: '/alerts', label: '提醒中心', icon: IconBell },
    { to: '/settings', label: '设置', icon: IconSettings },
]

// 主进程（托盘、通知、桌宠菜单）通过 navigate-to 要求跳转页面
function NavigationBridge() {
    const navigate = useNavigate()
    useEffect(() => window.api.app.onNavigate((route) => navigate(route)), [navigate])
    return null
}

// 主进程拦截 Cmd/Ctrl+R 后广播 app:refresh，各页面的 usePolling / 行情定时器监听后立即补拉一次
function RefreshBridge() {
    const [visible, setVisible] = useState(false)
    useEffect(() => {
        // onRefresh 是后加的 preload 方法；dev 下若 preload 尚未随进程重启而更新，这里会是
        // undefined。本组件在 ErrorBoundary 之外，必须兜底，否则一次抛错会让整个界面黑屏。
        if (typeof window.api?.app?.onRefresh !== 'function') return
        let timer: ReturnType<typeof setTimeout>
        const off = window.api.app.onRefresh(() => {
            window.dispatchEvent(new Event(APP_REFRESH_EVENT))
            setVisible(true)
            clearTimeout(timer)
            timer = setTimeout(() => setVisible(false), 1200)
        })
        return () => {
            off()
            clearTimeout(timer)
        }
    }, [])
    return visible ? <div className="app-refresh-toast">正在刷新…</div> : null
}

function PageSkeleton() {
    return (
        <div className="page page-skeleton">
            <div className="dash-skeleton" style={{ height: 28, width: 180 }} />
            <div className="dash-skeleton" style={{ height: 96 }} />
            <div className="dash-skeleton" style={{ height: 320 }} />
        </div>
    )
}

export default function App() {
    const { unread, signalUnread, refreshUnread, setUnread, setSignalUnread } = useAlertsStore()
    const totalUnread = unread + signalUnread
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1')

    useEffect(() => {
        const saved = localStorage.getItem('theme') || 'dark'
        document.documentElement.setAttribute('data-theme', saved)
    }, [])
    useEffect(() => {
        refreshUnread()
        const offAlerts = window.api.alerts.onChanged(({ unread }) => setUnread(unread))
        const offSignals = window.api.signals.onChanged(({ unread }) => setSignalUnread(unread))
        return () => {
            offAlerts()
            offSignals()
        }
    }, [refreshUnread, setUnread, setSignalUnread])

    const toggleCollapsed = () => {
        setCollapsed((v) => {
            localStorage.setItem('sidebar_collapsed', v ? '0' : '1')
            return !v
        })
    }

    const isMac = navigator.platform.toLowerCase().includes('mac')

    return (
        <HashRouter>
            <NavigationBridge />
            <RefreshBridge />
            <CommandPalette />
            <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
                <aside className="sidebar">
                    <div className="logo">
                        <IconLogo />
                        <span className="logo-text">StockMind</span>
                    </div>
                    <button
                        className="sidebar-search"
                        title="搜索股票 / 跳转页面"
                        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
                    >
                        <IconSearch />
                        <span className="nav-label">搜索</span>
                        <kbd className="nav-label">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
                    </button>
                    <nav className="nav">
                        {NAV.map(({ to, label, icon: Icon, end, title }) => (
                            <NavLink
                                key={to}
                                to={to}
                                end={end}
                                title={collapsed ? label : title}
                                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                            >
                                <Icon />
                                <span className="nav-label">{label}</span>
                                {to === '/alerts' && totalUnread > 0 && (
                                    <span className="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
                                )}
                            </NavLink>
                        ))}
                    </nav>
                    <div className="sidebar-footer">
                        <button className="sidebar-collapse" onClick={toggleCollapsed} title={collapsed ? '展开侧边栏' : '收起侧边栏'}>
                            <IconPanelLeft />
                        </button>
                        <span className="disclaimer nav-label">仅供参考，非投资建议</span>
                    </div>
                </aside>
                <main className="main-content">
                    <IndexTicker />
                    <div className="content-scroll">
                        <ErrorBoundary>
                            <Suspense fallback={<PageSkeleton />}>
                                <Routes>
                                    <Route path="/" element={<Dashboard />} />
                                    <Route path="/portfolio" element={<Portfolio />} />
                                    <Route path="/stock/:code" element={<StockDetail />} />
                                    <Route path="/realtime/:code" element={<RealtimeChart />} />
                                    <Route path="/watchlist" element={<Watchlist />} />
                                    <Route path="/screener" element={<Screener />} />
                                    <Route path="/radar" element={<SectorRadar />} />
                                    <Route path="/chat" element={<AIChat />} />
                                    <Route path="/alerts" element={<Alerts />} />
                                    <Route path="/settings" element={<Settings />} />
                                </Routes>
                            </Suspense>
                        </ErrorBoundary>
                    </div>
                </main>
            </div>
        </HashRouter>
    )
}
