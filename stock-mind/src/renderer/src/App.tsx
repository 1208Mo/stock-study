import { useEffect } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import Portfolio from './pages/Portfolio'
import StockDetail from './pages/StockDetail'
import Watchlist from './pages/Watchlist'
import Settings from './pages/Settings'
import DailyDecision from './pages/DailyDecision'
import RealtimeChart from './pages/RealtimeChart'
import AIChat from './pages/AIChat'

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
                            to="/decision"
                            className={({ isActive }) =>
                                isActive ? 'nav-item active' : 'nav-item'
                            }
                        >
                            每日决策
                        </NavLink>
                        <NavLink
                            to="/chat"
                            className={({ isActive }) =>
                                isActive ? 'nav-item active' : 'nav-item'
                            }
                        >
                            AI 对话
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
                    <Routes>
                        <Route path="/" element={<Portfolio />} />
                        <Route path="/stock/:code" element={<StockDetail />} />
                        <Route path="/realtime/:code" element={<RealtimeChart />} />
                        <Route path="/watchlist" element={<Watchlist />} />
                        <Route path="/decision" element={<DailyDecision />} />
                        <Route path="/chat" element={<AIChat />} />
                        <Route path="/settings" element={<Settings />} />
                    </Routes>
                </main>
            </div>
        </HashRouter>
    )
}
