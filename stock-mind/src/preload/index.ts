import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose electron API
contextBridge.exposeInMainWorld('electron', electronAPI)

// Expose typed API to renderer
const api = {
    // Holdings
    holdings: {
        getAll: () => ipcRenderer.invoke('holdings:getAll'),
        add: (code: string, name: string, costPrice: number, quantity: number, sector?: string, subSector?: string) =>
            ipcRenderer.invoke('holdings:add', code, name, costPrice, quantity, sector, subSector),
        update: (id: number, costPrice: number, quantity: number) =>
            ipcRenderer.invoke('holdings:update', id, costPrice, quantity),
        updateSector: (id: number, sector: string, subSector: string) =>
            ipcRenderer.invoke('holdings:updateSector', id, sector, subSector),
        delete: (id: number) => ipcRenderer.invoke('holdings:delete', id),
        addTrade: (holdingId: number, tradeType: 'buy' | 'sell', costPrice: number, quantity: number, note?: string) =>
            ipcRenderer.invoke('holdings:addTrade', holdingId, tradeType, costPrice, quantity, note),
        getTrades: (holdingId: number) => ipcRenderer.invoke('holdings:getTrades', holdingId),
    },

    // Watchlist
    watchlist: {
        getAll: () => ipcRenderer.invoke('watchlist:getAll'),
        add: (code: string, name: string, note?: string, sector?: string, subSector?: string) =>
            ipcRenderer.invoke('watchlist:add', code, name, note, sector, subSector),
        updateSector: (id: number, sector: string, subSector: string) =>
            ipcRenderer.invoke('watchlist:updateSector', id, sector, subSector),
        remove: (id: number) => ipcRenderer.invoke('watchlist:remove', id),
        getGroups: () => ipcRenderer.invoke('watchlist:getGroups'),
        addGroup: (name: string) => ipcRenderer.invoke('watchlist:addGroup', name),
        removeGroup: (name: string) => ipcRenderer.invoke('watchlist:removeGroup', name),
        setItemGroup: (itemId: number, groupName: string) =>
            ipcRenderer.invoke('watchlist:setItemGroup', itemId, groupName),
        getItemGroups: (): Promise<Array<[number, string]>> =>
            ipcRenderer.invoke('watchlist:getItemGroups'),
    },

    // Market data
    market: {
        getQuote: (code: string) => ipcRenderer.invoke('market:getQuote', code),
        getBatchQuotes: (codes: string[]) => ipcRenderer.invoke('market:getBatchQuotes', codes),
        getKLine: (code: string, days: number = 60) =>
            ipcRenderer.invoke('market:getKLine', code, days),
        getKLineEx: (code: string, period?: string, adjust?: string, limit?: number) =>
            ipcRenderer.invoke('market:getKLineEx', code, period, adjust, limit),
        getWeeklyKLine: (code: string, weeks: number = 60) =>
            ipcRenderer.invoke('market:getWeeklyKLine', code, weeks),
        getMonthlyKLine: (code: string, months: number = 36) =>
            ipcRenderer.invoke('market:getMonthlyKLine', code, months),
        getIntraday: (code: string, bars: number = 48) =>
            ipcRenderer.invoke('market:getIntraday', code, bars),
        getNews: (count?: number) => ipcRenderer.invoke('market:getNews', count),
        getTopSectors: (topN?: number) => ipcRenderer.invoke('market:getTopSectors', topN),
        getTopSectorTrends: (topN?: number, days?: number) =>
            ipcRenderer.invoke('market:getTopSectorTrends', topN, days),
        getDynamicCandidates: (topSectorCount?: number, perSector?: number) =>
            ipcRenderer.invoke('market:getDynamicCandidates', topSectorCount, perSector),
        getAmbushSectors: (limit?: number) =>
            ipcRenderer.invoke('market:getAmbushSectors', limit),
        search: (keyword: string) => ipcRenderer.invoke('market:search', keyword),
        getSectorInfo: (code: string) => ipcRenderer.invoke('market:getSectorInfo', code),
        getSectorKLine: (bkCode: string, days?: number) =>
            ipcRenderer.invoke('market:getSectorKLine', bkCode, days),
        getDividends: (code: string) => ipcRenderer.invoke('market:getDividends', code),
        getCapitalFlowDaily: (code: string, days?: number, market?: 'sh' | 'sz') =>
            ipcRenderer.invoke('market:getCapitalFlowDaily', code, days, market),
        getDailyKLine: (code: string, days?: number, market?: 'sh' | 'sz') =>
            ipcRenderer.invoke('market:getDailyKLine', code, days, market),
        getSectorCapitalFlow: (topN?: number) =>
            ipcRenderer.invoke('market:getSectorCapitalFlow', topN),
        getMarketFlowSnapshot: () => ipcRenderer.invoke('market:getMarketFlowSnapshot'),
        getIndexTicker: () => ipcRenderer.invoke('market:getIndexTicker'),
        getBreadth: () => ipcRenderer.invoke('market:getBreadth'),
        getSectorHeatmap: (topN?: number) => ipcRenderer.invoke('market:getSectorHeatmap', topN),
        getNewsFlash: (count?: number) => ipcRenderer.invoke('market:getNewsFlash', count),
        getRegime: () => ipcRenderer.invoke('market:getRegime'),
        getSectorTopStocks: (bkCode: string, topN?: number) =>
            ipcRenderer.invoke('market:getSectorTopStocks', bkCode, topN),
        getFundamentals: (code: string) =>
            ipcRenderer.invoke('market:getFundamentals', code),
    },

    stock: {
        news: (code: string, count?: number) => ipcRenderer.invoke('stock:news', code, count),
        notices: (code: string, count?: number) => ipcRenderer.invoke('stock:notices', code, count),
        tagSentiment: (
            stock: { code: string; name: string },
            items: Array<{ id: string; title: string; summary?: string }>
        ) => ipcRenderer.invoke('stock:tagSentiment', stock, items),
    },

    backtest: {
        strategies: () => ipcRenderer.invoke('backtest:strategies'),
        run: (input: {
            code: string
            name: string
            strategy: string
            params?: Record<string, number>
            days?: number
        }) => ipcRenderer.invoke('backtest:run', input),
    },

    portfolio: {
        analytics: (days?: number) => ipcRenderer.invoke('portfolio:analytics', days),
    },

    // 条件选股
    screener: {
        meta: () => ipcRenderer.invoke('screener:meta'),
        run: (criteria: unknown, requestId?: string) => ipcRenderer.invoke('screener:run', criteria, requestId),
        cancel: (requestId: string) => ipcRenderer.invoke('screener:cancel', requestId),
        onProgress: (cb: (data: { requestId?: string; done: number; total: number; hits: number }) => void) => {
            const handler = (_: unknown, data: { requestId?: string; done: number; total: number; hits: number }) => cb(data)
            ipcRenderer.on('screener:progress', handler)
            return () => ipcRenderer.removeListener('screener:progress', handler)
        },
    },

    // 技术信号监控
    signals: {
        meta: () => ipcRenderer.invoke('signals:meta'),
        listWatch: () => ipcRenderer.invoke('signals:listWatch'),
        addWatch: (items: Array<{ code: string; name: string }>, periods?: string, signals?: string) =>
            ipcRenderer.invoke('signals:addWatch', items, periods, signals),
        updateWatch: (id: number, patch: { periods?: string; signals?: string; enabled?: boolean; note?: string }) =>
            ipcRenderer.invoke('signals:updateWatch', id, patch),
        removeWatch: (id: number) => ipcRenderer.invoke('signals:removeWatch', id),
        setDefaults: (d: { periods?: string[]; signals?: string[]; enabled?: boolean }) =>
            ipcRenderer.invoke('signals:setDefaults', d),
        scanNow: () => ipcRenderer.invoke('signals:scanNow'),
        backfill: () => ipcRenderer.invoke('signals:backfill'),
        events: (q?: unknown) => ipcRenderer.invoke('signals:events', q),
        unreadCount: () => ipcRenderer.invoke('signals:unreadCount'),
        markRead: () => ipcRenderer.invoke('signals:markRead'),
        clearEvents: () => ipcRenderer.invoke('signals:clearEvents'),
        stats: (q?: { since?: string; code?: string; period?: string }) => ipcRenderer.invoke('signals:stats', q),
        onChanged: (cb: (data: { unread: number }) => void) => {
            const handler = (_: unknown, data: { unread: number }) => cb(data)
            ipcRenderer.on('signals:changed', handler)
            return () => ipcRenderer.removeListener('signals:changed', handler)
        },
    },

    // 自动更新
    updater: {
        getState: () => ipcRenderer.invoke('updater:getState'),
        check: () => ipcRenderer.invoke('updater:check'),
        download: () => ipcRenderer.invoke('updater:download'),
        install: () => ipcRenderer.invoke('updater:install'),
        openReleases: () => ipcRenderer.invoke('updater:openReleases'),
        onState: (cb: (state: unknown) => void) => {
            const handler = (_: unknown, s: unknown) => cb(s)
            ipcRenderer.on('updater:state', handler)
            return () => ipcRenderer.removeListener('updater:state', handler)
        },
    },

    // 价格提醒
    alerts: {
        list: () => ipcRenderer.invoke('alerts:list'),
        add: (input: {
            code: string
            name: string
            kind: 'price_above' | 'price_below' | 'pct_above' | 'pct_below'
            target: number
            note?: string
            source?: string
            repeatDaily?: boolean
        }) => ipcRenderer.invoke('alerts:add', input),
        setEnabled: (id: number, enabled: boolean) => ipcRenderer.invoke('alerts:setEnabled', id, enabled),
        delete: (id: number) => ipcRenderer.invoke('alerts:delete', id),
        events: (limit?: number) => ipcRenderer.invoke('alerts:events', limit),
        unreadCount: () => ipcRenderer.invoke('alerts:unreadCount'),
        markRead: () => ipcRenderer.invoke('alerts:markRead'),
        clearEvents: () => ipcRenderer.invoke('alerts:clearEvents'),
        checkNow: () => ipcRenderer.invoke('alerts:checkNow'),
        onChanged: (cb: (data: { unread: number }) => void) => {
            const handler = (_: unknown, data: { unread: number }) => cb(data)
            ipcRenderer.on('alerts:changed', handler)
            return () => ipcRenderer.removeListener('alerts:changed', handler)
        },
    },

    backup: {
        export: (kind: 'json' | 'db' | 'holdings-csv' | 'trades-csv', includeChat?: boolean) =>
            ipcRenderer.invoke('backup:export', kind, includeChat),
        import: () => ipcRenderer.invoke('backup:import'),
        revealDataDir: () => ipcRenderer.invoke('backup:revealDataDir'),
    },

    app: {
        dataSourceStatus: () => ipcRenderer.invoke('app:dataSourceStatus'),
        probeDataSource: () => ipcRenderer.invoke('app:probeDataSource'),
        setTrayEnabled: (enabled: boolean) => ipcRenderer.invoke('app:setTrayEnabled', enabled),
        onNavigate: (cb: (route: string) => void) => {
            const handler = (_: unknown, route: string) => cb(route)
            ipcRenderer.on('navigate-to', handler)
            return () => ipcRenderer.removeListener('navigate-to', handler)
        },
        // 主进程拦截 Cmd/Ctrl+R 后通知渲染层刷新当前页数据
        onRefresh: (cb: () => void) => {
            const handler = () => cb()
            ipcRenderer.on('app:refresh', handler)
            return () => ipcRenderer.removeListener('app:refresh', handler)
        },
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
        // 截图识别股票（持仓/自选批量导入）
        extractStocksFromImage: (payload: {
            images: Array<{ id: string; dataUrl: string; name: string; type: string }>
        }): Promise<Array<{ code: string; name: string; costPrice?: number; quantity?: number }>> =>
            ipcRenderer.invoke('ai:extractStocksFromImage', payload),
        agentDecision: (payload: {
            date: string
            candidateCodes: Array<{ code: string; name: string }>
            capital?: number
            riskLevel?: string
            requestId?: string
            debateRounds?: number
        }) => ipcRenderer.invoke('ai:agentDecision', payload),
        onAgentProgress: (
            cb: (data: {
                requestId: string
                node: string
                label: string
                content?: string
                round?: number
            }) => void
        ): (() => void) => {
            const handler = (
                _e: Electron.IpcRendererEvent,
                data: {
                    requestId: string
                    node: string
                    label: string
                    content?: string
                    round?: number
                }
            ) => cb(data)
            ipcRenderer.on('ai:agentDecision:progress', handler)
            return () => ipcRenderer.removeListener('ai:agentDecision:progress', handler)
        },
        chat: (payload: { messages: Array<{ role: string; content: string }> }) =>
            ipcRenderer.invoke('ai:chat', payload),
        // 流式对话（Step 4：以 sessionId 为 thread_id，历史由 checkpointer 管理）
        chatStream: (payload: { sessionId: string; input: string; images?: Array<{ id: string; dataUrl: string; name: string; type: string }> }, requestId: string) =>
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
        onChatAnalyzing: (
            cb: (data: { requestId: string; message: string }) => void
        ): (() => void) => {
            const handler = (_e: Electron.IpcRendererEvent, data: { requestId: string; message: string }) => cb(data)
            ipcRenderer.on('ai:chat:analyzing', handler)
            return () => ipcRenderer.removeListener('ai:chat:analyzing', handler)
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

    // Decision history & hit tracking
    decision: {
        list: (limit?: number) => ipcRenderer.invoke('decision:list', limit),
        getById: (id: number) => ipcRenderer.invoke('decision:getById', id),
        stats: (days?: number) => ipcRenderer.invoke('decision:stats', days),
        scorecard: (days?: number) => ipcRenderer.invoke('decision:scorecard', days),
        review: (decisionId?: number) => ipcRenderer.invoke('decision:review', decisionId),
        delete: (id: number) => ipcRenderer.invoke('decision:delete', id),
    },
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
