import { create } from 'zustand'

interface AlertsState {
    unread: number
    /** 技术信号未读数，与价格提醒分开计数，侧边栏徽标显示两者之和 */
    signalUnread: number
    refreshUnread: () => Promise<void>
    setUnread: (n: number) => void
    setSignalUnread: (n: number) => void
}

export const useAlertsStore = create<AlertsState>((set) => ({
    unread: 0,
    signalUnread: 0,
    refreshUnread: async () => {
        try {
            const [unread, signalUnread] = await Promise.all([
                window.api.alerts.unreadCount(),
                window.api.signals.unreadCount(),
            ])
            set({ unread, signalUnread })
        } catch {
            // 主进程未就绪时忽略
        }
    },
    setUnread: (n) => set({ unread: n }),
    setSignalUnread: (n) => set({ signalUnread: n }),
}))
