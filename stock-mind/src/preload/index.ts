import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose electron API
contextBridge.exposeInMainWorld('electron', electronAPI)

// Expose typed API to renderer
const api = {
    // Holdings
    holdings: {
        getAll: () => ipcRenderer.invoke('holdings:getAll'),
        add: (code: string, name: string, costPrice: number, quantity: number) =>
            ipcRenderer.invoke('holdings:add', code, name, costPrice, quantity),
        update: (id: number, costPrice: number, quantity: number) =>
            ipcRenderer.invoke('holdings:update', id, costPrice, quantity),
        delete: (id: number) => ipcRenderer.invoke('holdings:delete', id),
    },

    // Watchlist
    watchlist: {
        getAll: () => ipcRenderer.invoke('watchlist:getAll'),
        add: (code: string, name: string, note?: string) =>
            ipcRenderer.invoke('watchlist:add', code, name, note),
        remove: (id: number) => ipcRenderer.invoke('watchlist:remove', id),
    },

    // Market data
    market: {
        getQuote: (code: string) => ipcRenderer.invoke('market:getQuote', code),
        getBatchQuotes: (codes: string[]) => ipcRenderer.invoke('market:getBatchQuotes', codes),
        getKLine: (code: string, days: number = 60) =>
            ipcRenderer.invoke('market:getKLine', code, days),
        getWeeklyKLine: (code: string, weeks: number = 60) =>
            ipcRenderer.invoke('market:getWeeklyKLine', code, weeks),
        getMonthlyKLine: (code: string, months: number = 36) =>
            ipcRenderer.invoke('market:getMonthlyKLine', code, months),
        getIntraday: (code: string, bars: number = 48) =>
            ipcRenderer.invoke('market:getIntraday', code, bars),
        getNews: (count?: number) => ipcRenderer.invoke('market:getNews', count),
        getTopSectors: (topN?: number) => ipcRenderer.invoke('market:getTopSectors', topN),
        getDynamicCandidates: (topSectorCount?: number, perSector?: number) =>
            ipcRenderer.invoke('market:getDynamicCandidates', topSectorCount, perSector),
        getAmbushSectors: (limit?: number) =>
            ipcRenderer.invoke('market:getAmbushSectors', limit),
        search: (keyword: string) => ipcRenderer.invoke('market:search', keyword),
        getSectorInfo: (code: string) => ipcRenderer.invoke('market:getSectorInfo', code),
        getSectorKLine: (bkCode: string, days?: number) =>
            ipcRenderer.invoke('market:getSectorKLine', bkCode, days),
        getDividends: (code: string) => ipcRenderer.invoke('market:getDividends', code),
    },

    // Settings
    settings: {
        get: (key: string) => ipcRenderer.invoke('settings:get', key),
        set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    },

    // Long-term memory
    memory: {
        getInvestorProfile: () => ipcRenderer.invoke('memory:getInvestorProfile'),
        updateInvestorProfile: (payload: {
            capital?: number | null
            riskLevel?: string
            preferredTypes?: string
            avoidTypes?: string
            preferredSectors?: string
            notes?: string
        }) => ipcRenderer.invoke('memory:updateInvestorProfile', payload),
    },

    // AI
    ai: {
        analyze: (code: string, name: string, price: number, changePercent: number) =>
            ipcRenderer.invoke('ai:analyze', code, name, price, changePercent),
        dailyDecision: (payload: {
            capital: number
            riskLevel: string
            focus: string
            candidates: Array<{
                code: string
                name: string
                price: number
                changePercent: number
                aggressiveEntry: number
                conservativeEntry: number
                stopLoss: number
                takeProfit: number
                noBuyReason: string | null
            }>
        }) => ipcRenderer.invoke('ai:dailyDecision', payload),
        getHistory: (code: string) => ipcRenderer.invoke('ai:getHistory', code),
        readKLine: (payload: {
            code: string
            name: string
            currentPrice: number
            changePercent: number
            klines: Array<{
                date: string
                open: number
                close: number
                high: number
                low: number
                volume: number
            }>
        }) => ipcRenderer.invoke('ai:readKLine', payload),
        tradingT: (payload: {
            code: string
            name: string
            costPrice: number
            holdQuantity: number
            currentPrice: number
            changePercent: number
            todayOpen: number
            todayHigh: number
            todayLow: number
            intraday: Array<{
                date: string
                open: number
                close: number
                high: number
                low: number
                volume: number
            }>
        }) => ipcRenderer.invoke('ai:tradingT', payload),
        marketContext: (payload: {
            news: string[]
            date: string
            topSectors?: Array<{ name: string; changePercent: number }>
            ambushSectors?: Array<{
                name: string
                changePercent: number
                return5d: number
                return10d: number
                volumeTrend: number
                distanceToHigh: number
                reasons: string[]
            }>
        }) => ipcRenderer.invoke('ai:marketContext', payload),
        agentDecision: (payload: {
            date: string
            candidateCodes: Array<{ code: string; name: string }>
            capital?: number
            riskLevel?: string
        }) => ipcRenderer.invoke('ai:agentDecision', payload),
        chat: (payload: { messages: Array<{ role: string; content: string }> }) =>
            ipcRenderer.invoke('ai:chat', payload),
        // 流式对话（Step 4：以 sessionId 为 thread_id，历史由 checkpointer 管理）
        chatStream: (payload: { sessionId: string; input: string }, requestId: string) =>
            ipcRenderer.send('ai:chat:start', { ...payload, requestId }),
        chatStop: (requestId: string) => ipcRenderer.send('ai:chat:stop', { requestId }),
        onChatChunk: (
            cb: (data: { requestId: string; chunk: string }) => void
        ): (() => void) => {
            const handler = (_e: Electron.IpcRendererEvent, data: { requestId: string; chunk: string }) => cb(data)
            ipcRenderer.on('ai:chat:chunk', handler)
            return () => ipcRenderer.removeListener('ai:chat:chunk', handler)
        },
        onChatDone: (
            cb: (data: {
                requestId: string
                toolCalls: unknown[]
                aborted?: boolean
            }) => void
        ): (() => void) => {
            const handler = (
                _e: Electron.IpcRendererEvent,
                data: { requestId: string; toolCalls: unknown[]; aborted?: boolean }
            ) => cb(data)
            ipcRenderer.on('ai:chat:done', handler)
            return () => ipcRenderer.removeListener('ai:chat:done', handler)
        },
        onChatError: (
            cb: (data: { requestId: string; error: string }) => void
        ): (() => void) => {
            const handler = (_e: Electron.IpcRendererEvent, data: { requestId: string; error: string }) => cb(data)
            ipcRenderer.on('ai:chat:error', handler)
            return () => ipcRenderer.removeListener('ai:chat:error', handler)
        },
    },

    // Chat sessions（多会话管理）
    chat: {
        listSessions: (): Promise<
            Array<{ id: string; title: string; created_at: string; updated_at: string }>
        > => ipcRenderer.invoke('chat:listSessions'),
        createSession: (
            title?: string
        ): Promise<{ id: string; title: string; created_at: string; updated_at: string }> =>
            ipcRenderer.invoke('chat:createSession', title),
        renameSession: (id: string, title: string) =>
            ipcRenderer.invoke('chat:renameSession', id, title),
        deleteSession: (id: string): Promise<boolean> =>
            ipcRenderer.invoke('chat:deleteSession', id),
        getMessages: (
            sessionId: string
        ): Promise<
            Array<{
                id: number
                session_id: string
                role: string
                content: string
                tool_calls: string | null
                created_at: string
            }>
        > => ipcRenderer.invoke('chat:getMessages', sessionId),
        restoreFromCheckpoint: (
            sessionId: string
        ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> =>
            ipcRenderer.invoke('chat:restoreFromCheckpoint', sessionId),
    },
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
