import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'

const Portfolio = lazy(() => import('./pages/Portfolio'))
const StockDetail = lazy(() => import('./pages/StockDetail'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Settings = lazy(() => import('./pages/Settings'))
const RealtimeChart = lazy(() => import('./pages/RealtimeChart'))
const AIChat = lazy(() => import('./pages/AIChat'))
const SectorRadar = lazy(() => import('./pages/SectorRadar'))

export default function App() {
    useEffect(() => {
        const saved = localStorage.getItem('theme') || 'dark'
        document.documentElement.setAttribute('data-theme', saved)
    }, [])
    return (
        <HashRouter>
            <div className="app-layout">
                <aside className="sidebar">
                    <div className="logo">
                        <span className="logo-icon">📈</span>
                        <span className="logo-text">StockMind</span>
                    </div>
                    <nav className="nav">
                        <NavLink
                            to="/"
                            end
                            className={({ isActive }) =>
                                isActive ? 'nav-item active' : 'nav-item'
                            }
                        >
                            持仓管理
                        </NavLink>
                        <NavLink
                            to="/watchlist"
                            className={({ isActive }) =>
                                isActive ? 'nav-item active' : 'nav-item'
                            }
                        >
                            观察列表
                        </NavLink>
                        <NavLink
                            to="/radar"
                            className={({ isActive }) =>
                                isActive ? 'nav-item active' : 'nav-item'
                            }
                        >
                            板块雷达
                        </NavLink>
                        <NavLink
                            to="/chat"
                            title="AI 投研助手：对话问答 + 每日计划 + 战绩追踪"
                            className={({ isActive }) =>
                                isActive ? 'nav-item active' : 'nav-item'
                            }
                        >
                            小墨鱼 AI
                        </NavLink>
                        <NavLink
                            to="/settings"
                            className={({ isActive }) =>
                                isActive ? 'nav-item active' : 'nav-item'
                            }
                        >
                            设置
                        </NavLink>
                    </nav>
                    <div className="sidebar-footer">
                        <span className="disclaimer">仅供参考，非投资建议</span>
                    </div>
                </aside>
                <main className="main-content">
                    <ErrorBoundary>
                        <Suspense fallback={<div className="loading-state">加载中...</div>}>
                            <Routes>
                            <Route path="/" element={<Portfolio />} />
                            <Route path="/stock/:code" element={<StockDetail />} />
                            <Route path="/realtime/:code" element={<RealtimeChart />} />
                            <Route path="/watchlist" element={<Watchlist />} />
                            <Route path="/radar" element={<SectorRadar />} />
                            <Route path="/chat" element={<AIChat />} />
                            <Route path="/settings" element={<Settings />} />
                        </Routes>
                    </Suspense>
                    </ErrorBoundary>
                </main>
            </div>
        </HashRouter>
    )
}
