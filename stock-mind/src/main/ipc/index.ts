import { dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import {
    getAllHoldings,
    addHolding,
    updateHolding,
    updateHoldingSector,
    deleteHolding,
    addTrade,
    getHoldingTrades,
    getAllWatchlist,
    addToWatchlist,
    updateWatchlistSector,
    removeFromWatchlist,
    getAllWatchlistGroups,
    addWatchlistGroup,
    removeWatchlistGroup,
    setWatchlistItemGroup,
    getAllWatchlistItemGroups,
    getSetting,
    setSetting,
    getInvestorProfile,
    updateInvestorProfile,
    formatInvestorProfile,
    saveAnalysis,
    getAnalysesForStock,
    saveDecision,
    getDecisions,
    getDecisionById,
    getPickReviewsByDecisionId,
    getDecisionStats,
    getDecisionScorecard,
    getDbPath,
    deleteDecision,
    listChatSessions,
    createChatSession,
    renameChatSession,
    touchChatSession,
    deleteChatSession,
    listChatMessages,
    appendChatMessage,
    deleteChatMessage,
    listPriceAlerts,
    addPriceAlert,
    setPriceAlertEnabled,
    deletePriceAlert,
    listAlertEvents,
    countUnreadAlertEvents,
    markAlertEventsRead,
    clearAlertEvents,
    listSignalWatch,
    addSignalWatch,
    updateSignalWatch,
    removeSignalWatch,
    listSignalEvents,
    countUnreadSignalEvents,
    markSignalEventsRead,
    clearSignalEvents,
    type SignalEventQuery,
    type PriceAlertKind,
} from '../db'
import {
    fetchQuote,
    fetchBatchQuotes,
    fetchKLine,
    fetchKLineEx,
    type KLinePeriod,
    type AdjustType,
    fetchWeeklyKLine,
    fetchMonthlyKLine,
    fetchIntraday,
    fetchMarketNews,
    fetchTopSectors,
    fetchDynamicCandidates,
    fetchAmbushSectors,
    fetchSectorInfo,
    fetchSectorKLine,
    fetchDividends,
    fetchSectorTopStocks,
    fetchTopSectorTrends,
    searchStock,
} from '../services/market'
import { fetchCapitalFlowDaily, fetchMarketFlowSnapshot, fetchDailyKLine, fetchSectorCapitalFlow } from '../services/capitalFlow'
import { fetchFundamentals } from '../services/fundamentals'
import { fetchIndexTicker, fetchMarketBreadth, fetchSectorHeatmap, fetchNewsFlash } from '../services/marketOverview'
import { assessMarketRegime } from '../services/marketRegime'
import { checkPriceAlerts, setTrayEnabled } from '../services/alerts'
import { getPush2Status, probePush2 } from '../services/dataSource'
import { runBacktest, STRATEGIES, type StrategyId } from '../services/backtest'
import { BUILTIN_PRESETS, cancelScreener, runScreener, type ScreenerCriteria } from '../services/screener'
import { PATTERNS, SIGNALS } from '../services/patterns'
import { computeSignalStats, getSignalDefaults, MONITOR_PERIODS, scanSignals, type SignalHooks } from '../services/signalMonitor'
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate, openReleasePage } from '../services/updater'
import {
    exportBackupJson,
    exportDbFile,
    exportHoldingsCsv,
    exportTradesCsv,
    importBackupJson,
} from '../services/backup'
import { computePortfolioAnalytics } from '../services/portfolioAnalytics'
import { fetchStockNews, fetchStockNotices, tagNewsSentiment } from '../services/stockNews'
import {
    callAI,
    buildStockAnalysisPrompt,
    buildDailyDecisionPrompt,
    buildKLineReadingPrompt,
    buildTradingTPrompt,
    buildMarketContextPrompt,
    AIProvider,
} from '../services/ai'
import { runDecisionAgent } from '../services/agent'
import { runResearchAgent, getSessionMessagesFromCheckpoint, modelSupportsVision, analyzeImagesWithVision, extractStocksFromImage, type ImageContent } from '../services/researchAgent'
import { reviewDecision, runPendingDecisionReviews } from '../services/decisionReview'

function getConfiguredAI() {
    // 最高优先级：环境变量中转配置（AI_API_KEY / AI_BASE_URL / AI_MODEL）
    // 用于统一的 OpenAI 兼容中转，配好这三个变量即可全局生效，无需在设置里逐个 provider 配置。
    const envKey = process.env.AI_API_KEY?.trim()
    if (envKey) {
        console.log(
            `[AI] 使用环境变量中转 model=${process.env.AI_MODEL?.trim() || '(默认)'} baseUrl=${process.env.AI_BASE_URL?.trim() || '(默认)'}`
        )
        return {
            // 中转走 OpenAI 兼容协议，provider 仅用于兜底默认值/日志展示
            provider: 'openai' as AIProvider,
            apiKey: envKey,
            baseUrl: process.env.AI_BASE_URL?.trim() || undefined,
            model: process.env.AI_MODEL?.trim() || undefined,
            fastModel: process.env.AI_FAST_MODEL?.trim() || undefined,
        }
    }

    // 次优先级：设置页里开启的「自定义中转」（OpenAI 兼容），开启后忽略下方 provider 选择。
    if (getSetting('ai_use_custom') === '1') {
        const apiKey = (getSetting('ai_custom_key') ?? '').trim()
        if (!apiKey) {
            throw new Error('请先在设置中填写「自定义中转」的 API Key')
        }
        const baseUrl = getSetting('ai_custom_base_url')?.trim() || undefined
        const model = getSetting('ai_custom_model')?.trim() || undefined
        const fastModel = getSetting('ai_custom_fast_model')?.trim() || undefined
        console.log(`[AI] 使用自定义中转 model=${model || '(默认)'} baseUrl=${baseUrl || '(默认)'}`)
        return {
            provider: 'openai' as AIProvider,
            apiKey,
            baseUrl,
            model,
            fastModel,
        }
    }

    const provider = (getSetting('ai_provider') ?? 'deepseek') as AIProvider
    const apiKey = (getSetting(`ai_key_${provider}`) ?? '').trim()
    if (!apiKey) {
        throw new Error(`请先在设置中为"${provider}"配置 API Key`)
    }
    const baseUrl = getSetting(`ai_base_url_${provider}`)?.trim() || undefined
    const model = getSetting(`ai_model_${provider}`)?.trim() || undefined
    const fastModel = getSetting(`ai_fast_model_${provider}`)?.trim() || undefined
    console.log(`[AI] 使用供应商=${provider} model=${model || '(默认)'} baseUrl=${baseUrl || '(默认)'}`)
    return { provider, apiKey, baseUrl, model, fastModel }
}

function formatChatError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error)
    if (/角色信息不能为空|role.*(?:empty|required)|(?:empty|required).*role/i.test(raw)) {
        return '当前对话历史格式异常，已自动整理，请点击“重试”继续对话'
    }
    if (/stream disconnected|error sending request|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(raw)) {
        return 'AI 服务连接中断。请检查 API Base URL/代理是否可用，然后点击“重试”。'
    }
    return raw
}

export function registerAllIpcHandlers(): void {
    // --- Holdings ---
    ipcMain.handle('holdings:getAll', () => getAllHoldings())

    ipcMain.handle(
        'holdings:add',
        (
            _e,
            code: string,
            name: string,
            costPrice: number,
            quantity: number,
            sector?: string,
            subSector?: string
        ) => {
            return addHolding(code, name, costPrice, quantity, sector, subSector)
        }
    )

    ipcMain.handle('holdings:update', (_e, id: number, costPrice: number, quantity: number) => {
        return updateHolding(id, costPrice, quantity)
    })

    ipcMain.handle(
        'holdings:updateSector',
        (_e, id: number, sector: string, subSector: string) => {
            return updateHoldingSector(id, sector, subSector)
        }
    )

    ipcMain.handle('holdings:delete', (_e, id: number) => deleteHolding(id))

    ipcMain.handle(
        'holdings:addTrade',
        (_e, holdingId: number, tradeType: 'buy' | 'sell', costPrice: number, quantity: number, note?: string) => {
            return addTrade(holdingId, tradeType, costPrice, quantity, note)
        }
    )

    ipcMain.handle('holdings:getTrades', (_e, holdingId: number) => getHoldingTrades(holdingId))

    // --- Watchlist ---
    ipcMain.handle('watchlist:getAll', () => getAllWatchlist())

    ipcMain.handle(
        'watchlist:add',
        (
            _e,
            code: string,
            name: string,
            note?: string,
            sector?: string,
            subSector?: string
        ) => {
            return addToWatchlist(code, name, note, sector, subSector)
        }
    )

    ipcMain.handle(
        'watchlist:updateSector',
        (_e, id: number, sector: string, subSector: string) => {
            return updateWatchlistSector(id, sector, subSector)
        }
    )

    ipcMain.handle('watchlist:remove', (_e, id: number) => removeFromWatchlist(id))

    ipcMain.handle('watchlist:getGroups', () => getAllWatchlistGroups())

    ipcMain.handle('watchlist:addGroup', (_e, name: string) => addWatchlistGroup(name))

    ipcMain.handle('watchlist:removeGroup', (_e, name: string) => removeWatchlistGroup(name))

    ipcMain.handle('watchlist:setItemGroup', (_e, itemId: number, groupName: string) =>
        setWatchlistItemGroup(itemId, groupName)
    )

    ipcMain.handle('watchlist:getItemGroups', () => {
        const map = getAllWatchlistItemGroups()
        return Array.from(map.entries())
    })

    // --- Market data ---
    ipcMain.handle('market:getQuote', (_e, code: string) => fetchQuote(code))

    ipcMain.handle('market:getBatchQuotes', (_e, codes: string[]) => fetchBatchQuotes(codes))

    ipcMain.handle('market:getKLine', (_e, code: string, days: number) => fetchKLine(code, days))

    ipcMain.handle(
        'market:getKLineEx',
        (_e, code: string, period?: KLinePeriod, adjust?: AdjustType, limit?: number) =>
            fetchKLineEx(code, period ?? 'day', adjust ?? 'qfq', limit ?? 120)
    )

    ipcMain.handle('market:getWeeklyKLine', (_e, code: string, weeks: number) =>
        fetchWeeklyKLine(code, weeks ?? 60)
    )

    ipcMain.handle('market:getMonthlyKLine', (_e, code: string, months: number) =>
        fetchMonthlyKLine(code, months ?? 36)
    )

    ipcMain.handle('market:search', (_e, keyword: string) => searchStock(keyword))

    ipcMain.handle('market:getSectorInfo', (_e, code: string) => fetchSectorInfo(code))

    ipcMain.handle('market:getSectorKLine', (_e, bkCode: string, days?: number) =>
        fetchSectorKLine(bkCode, days ?? 7)
    )

    ipcMain.handle('market:getDividends', (_e, code: string) => fetchDividends(code))

    ipcMain.handle('market:getIntraday', (_e, code: string, bars: number) =>
        fetchIntraday(code, bars)
    )

    ipcMain.handle('market:getNews', (_e, count?: number) => fetchMarketNews(count ?? 20))

    ipcMain.handle('market:getTopSectors', (_e, topN?: number) => fetchTopSectors(topN ?? 10))

    ipcMain.handle('market:getTopSectorTrends', (_e, topN?: number, days?: number) =>
        fetchTopSectorTrends(topN ?? 12, days ?? 7)
    )

    ipcMain.handle(
        'market:getDynamicCandidates',
        (_e, topSectorCount?: number, perSector?: number) =>
            fetchDynamicCandidates(topSectorCount ?? 5, perSector ?? 4)
    )

    ipcMain.handle('market:getAmbushSectors', (_e, limit?: number) =>
        fetchAmbushSectors(limit ?? 8)
    )

    ipcMain.handle(
        'market:getCapitalFlowDaily',
        (_e, code: string, days?: number, market?: 'sh' | 'sz') =>
            fetchCapitalFlowDaily(code, days ?? 30, market)
    )

    ipcMain.handle(
        'market:getDailyKLine',
        (_e, code: string, days?: number, market?: 'sh' | 'sz') =>
            fetchDailyKLine(code, days ?? 30, market)
    )

    ipcMain.handle('market:getSectorCapitalFlow', (_e, topN?: number) =>
        fetchSectorCapitalFlow(topN ?? 15)
    )

    ipcMain.handle('market:getMarketFlowSnapshot', () => fetchMarketFlowSnapshot())

    ipcMain.handle('alerts:list', () => listPriceAlerts())
    ipcMain.handle(
        'alerts:add',
        (
            _e,
            input: {
                code: string
                name: string
                kind: PriceAlertKind
                target: number
                note?: string
                source?: string
                repeatDaily?: boolean
            }
        ) => addPriceAlert(input)
    )
    ipcMain.handle('alerts:setEnabled', (_e, id: number, enabled: boolean) => setPriceAlertEnabled(id, enabled))
    ipcMain.handle('alerts:delete', (_e, id: number) => deletePriceAlert(id))
    ipcMain.handle('alerts:events', (_e, limit?: number) => listAlertEvents(limit ?? 100))
    ipcMain.handle('alerts:unreadCount', () => countUnreadAlertEvents())
    ipcMain.handle('alerts:markRead', () => markAlertEventsRead())
    ipcMain.handle('alerts:clearEvents', () => clearAlertEvents())
    ipcMain.handle('alerts:checkNow', () =>
        checkPriceAlerts(
            {
                openRoute: () => {},
                sendToPet: () => {},
            },
            true
        )
    )

    // --- 条件选股 ---
    ipcMain.handle('screener:meta', () => ({ patterns: PATTERNS, presets: BUILTIN_PRESETS }))
    ipcMain.handle('screener:run', (e, criteria: ScreenerCriteria, requestId?: string) =>
        runScreener(criteria, {
            requestId,
            onProgress: (p) => {
                if (!e.sender.isDestroyed()) e.sender.send('screener:progress', { requestId, ...p })
            },
        })
    )
    ipcMain.handle('screener:cancel', (_e, requestId: string) => cancelScreener(requestId))

    // --- 技术信号监控 ---
    const silentHooks: SignalHooks = { openRoute: () => {}, sendToPet: () => {} }
    ipcMain.handle('signals:meta', () => ({ signals: SIGNALS, periods: MONITOR_PERIODS, defaults: getSignalDefaults() }))
    ipcMain.handle('signals:listWatch', () => listSignalWatch())
    ipcMain.handle(
        'signals:addWatch',
        (_e, items: Array<{ code: string; name: string }>, periods?: string, signals?: string) => {
            const added = addSignalWatch(items, periods ?? '', signals ?? '')
            // 新加入的票回填最近的历史信号，让收益统计马上有样本（异步，不阻塞界面）
            const codes = new Set(items.map((i) => i.code))
            const ids = listSignalWatch()
                .filter((w) => codes.has(w.code))
                .map((w) => w.id)
            void scanSignals(silentHooks, { force: true, backfill: true, watchIds: ids })
            return added
        }
    )
    ipcMain.handle(
        'signals:updateWatch',
        (_e, id: number, patch: { periods?: string; signals?: string; enabled?: boolean; note?: string }) => {
            updateSignalWatch(id, patch)
            // 改了周期或信号，用新配置回填一次
            if (patch.periods !== undefined || patch.signals !== undefined) {
                void scanSignals(silentHooks, { force: true, backfill: true, watchIds: [id] })
            }
        }
    )
    ipcMain.handle('signals:removeWatch', (_e, id: number) => removeSignalWatch(id))
    ipcMain.handle('signals:setDefaults', (_e, d: { periods?: string[]; signals?: string[]; enabled?: boolean }) => {
        if (d.periods) setSetting('signal_default_periods', d.periods.join(','))
        if (d.signals) setSetting('signal_default_signals', d.signals.join(','))
        if (d.enabled !== undefined) setSetting('signal_monitor_enabled', d.enabled ? '1' : '0')
        return getSignalDefaults()
    })
    ipcMain.handle('signals:scanNow', () => scanSignals(silentHooks, { force: true }))
    ipcMain.handle('signals:backfill', () => scanSignals(silentHooks, { force: true, backfill: true }))
    ipcMain.handle('signals:events', (_e, q?: SignalEventQuery) => listSignalEvents(q ?? {}))
    ipcMain.handle('signals:unreadCount', () => countUnreadSignalEvents())
    ipcMain.handle('signals:markRead', () => markSignalEventsRead())
    ipcMain.handle('signals:clearEvents', () => clearSignalEvents())
    ipcMain.handle('signals:stats', (_e, q?: { since?: string; code?: string; period?: string }) =>
        computeSignalStats(q ?? {})
    )

    // --- 自动更新 ---
    ipcMain.handle('updater:getState', () => getUpdateState())
    ipcMain.handle('updater:check', () => checkForUpdates())
    ipcMain.handle('updater:download', () => downloadUpdate())
    ipcMain.handle('updater:install', () => installUpdate())
    ipcMain.handle('updater:openReleases', () => openReleasePage())
    // --- 数据备份与导出 ---
    const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

    ipcMain.handle(
        'backup:export',
        async (_e, kind: 'json' | 'db' | 'holdings-csv' | 'trades-csv', includeChat?: boolean) => {
            const presets = {
                json: { name: `stockmind-backup-${stamp()}.json`, filters: [{ name: 'JSON 备份', extensions: ['json'] }] },
                db: { name: `stockmind-${stamp()}.db`, filters: [{ name: '数据库文件', extensions: ['db'] }] },
                'holdings-csv': { name: `持仓-${stamp()}.csv`, filters: [{ name: 'CSV 表格', extensions: ['csv'] }] },
                'trades-csv': { name: `交易流水-${stamp()}.csv`, filters: [{ name: 'CSV 表格', extensions: ['csv'] }] },
            }[kind]
            const { canceled, filePath } = await dialog.showSaveDialog({
                title: '保存到',
                defaultPath: presets.name,
                filters: presets.filters,
            })
            if (canceled || !filePath) return { canceled: true as const }
            if (kind === 'json') return { canceled: false as const, ...exportBackupJson(filePath, !!includeChat) }
            if (kind === 'db') return { canceled: false as const, ...exportDbFile(filePath) }
            if (kind === 'holdings-csv') return { canceled: false as const, ...exportHoldingsCsv(filePath) }
            return { canceled: false as const, ...exportTradesCsv(filePath) }
        }
    )

    ipcMain.handle('backup:import', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: '选择 StockMind JSON 备份',
            properties: ['openFile'],
            filters: [{ name: 'JSON 备份', extensions: ['json'] }],
        })
        if (canceled || filePaths.length === 0) return { canceled: true as const }

        const confirm = await dialog.showMessageBox({
            type: 'warning',
            buttons: ['取消', '覆盖导入'],
            defaultId: 0,
            cancelId: 0,
            title: '确认导入备份',
            message: '导入会用备份内容覆盖当前数据',
            detail:
                '持仓、交易流水、自选、提醒、决策历史与战绩都会被备份里的内容替换。\n' +
                '导入前会自动把当前数据库另存为 stockmind.db.before-restore 兜底。\n' +
                '导入完成后请重启应用。',
        })
        if (confirm.response !== 1) return { canceled: true as const }

        return { canceled: false as const, ...importBackupJson(filePaths[0]) }
    })

    ipcMain.handle('backup:revealDataDir', async () => {
        shell.showItemInFolder(getDbPath())
        return true
    })

    ipcMain.handle('app:dataSourceStatus', () => getPush2Status())
    ipcMain.handle('app:probeDataSource', async () => {
        await probePush2(true)
        return getPush2Status()
    })
    ipcMain.handle('app:setTrayEnabled', (_e, enabled: boolean) => setTrayEnabled(enabled))

    ipcMain.handle('stock:news', (_e, code: string, count?: number) => fetchStockNews(code, count ?? 20))
    ipcMain.handle('stock:notices', (_e, code: string, count?: number) => fetchStockNotices(code, count ?? 20))
    ipcMain.handle(
        'stock:tagSentiment',
        (
            _e,
            stock: { code: string; name: string },
            items: Array<{ id: string; title: string; summary?: string }>
        ) => tagNewsSentiment(getConfiguredAI(), stock, items)
    )

    ipcMain.handle('portfolio:analytics', (_e, days?: number) => computePortfolioAnalytics(days ?? 250))

    ipcMain.handle('market:getIndexTicker', () => fetchIndexTicker())
    ipcMain.handle('market:getBreadth', () => fetchMarketBreadth())
    ipcMain.handle('market:getSectorHeatmap', (_e, topN?: number) => fetchSectorHeatmap(topN ?? 60))
    ipcMain.handle('market:getNewsFlash', (_e, count?: number) => fetchNewsFlash(count ?? 30))
    ipcMain.handle('market:getRegime', () => assessMarketRegime())

    ipcMain.handle('market:getSectorTopStocks', (_e, bkCode: string, topN?: number) =>
        fetchSectorTopStocks(bkCode, topN ?? 8)
    )

    ipcMain.handle('market:getFundamentals', (_e, code: string) =>
        fetchFundamentals(code)
    )

    ipcMain.handle(
        'ai:marketContext',
        async (
            _e,
            payload: {
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
            }
        ) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()
            const messages = buildMarketContextPrompt(
                payload.news,
                payload.date,
                payload.topSectors,
                payload.ambushSectors
            )
            return callAI(provider, { apiKey, baseUrl, model }, messages)
        }
    )

    // --- Settings ---
    ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))

    ipcMain.handle('settings:set', (_e, key: string, value: string) => setSetting(key, value))

    // --- Long-term memory ---
    ipcMain.handle('memory:getInvestorProfile', () => getInvestorProfile())

    ipcMain.handle(
        'memory:updateInvestorProfile',
        (
            _e,
            payload: {
                capital?: number | null
                riskLevel?: string
                preferredTypes?: string
                avoidTypes?: string
                preferredSectors?: string
                notes?: string
            }
        ) => updateInvestorProfile(payload)
    )

    // --- AI ---
    ipcMain.handle(
        'ai:analyze',
        async (_e, code: string, name: string, price: number, changePercent: number) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()

            const messages = buildStockAnalysisPrompt(name, code, price, changePercent)
            const result = await callAI(provider, { apiKey, baseUrl, model }, messages)
            saveAnalysis(code, result.model, messages[messages.length - 1].content, result.content)
            return result
        }
    )

    ipcMain.handle(
        'ai:dailyDecision',
        async (
            _e,
            payload: {
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
                    high?: number
                    low?: number
                    open?: number
                    volume?: number
                    avgVolume?: number
                }>
            }
        ) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()

            const messages = buildDailyDecisionPrompt(
                payload.capital,
                payload.riskLevel,
                payload.focus,
                payload.candidates
            )
            return callAI(provider, { apiKey, baseUrl, model }, messages)
        }
    )

    ipcMain.handle('ai:getHistory', (_e, code: string) => getAnalysesForStock(code))

    ipcMain.handle(
        'ai:readKLine',
        async (
            _e,
            payload: {
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
            }
        ) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()
            const messages = buildKLineReadingPrompt(
                payload.name,
                payload.code,
                payload.klines,
                payload.currentPrice,
                payload.changePercent
            )
            return callAI(provider, { apiKey, baseUrl, model }, messages)
        }
    )

    // 截图识别股票：供持仓管理 / 观察列表的「截图导入」使用
    ipcMain.handle(
        'ai:extractStocksFromImage',
        async (_e, payload: { images: ImageContent[] }) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()
            return extractStocksFromImage(provider, apiKey, baseUrl, payload.images, model)
        }
    )

    ipcMain.handle(
        'ai:tradingT',
        async (
            _e,
            payload: {
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
            }
        ) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()
            const messages = buildTradingTPrompt(
                payload.name,
                payload.code,
                payload.costPrice,
                payload.holdQuantity,
                payload.currentPrice,
                payload.changePercent,
                payload.todayOpen,
                payload.todayHigh,
                payload.todayLow,
                payload.intraday
            )
            return callAI(provider, { apiKey, baseUrl, model }, messages)
        }
    )

    // --- AI Agent (LangGraph) ---
    ipcMain.handle(
        'ai:agentDecision',
        async (
            event,
            payload: {
                date: string
                candidateCodes: Array<{ code: string; name: string }>
                capital?: number
                riskLevel?: string
                requestId?: string
                debateRounds?: number
            }
        ) => {
            const { provider, apiKey, baseUrl, model, fastModel } = getConfiguredAI()
            const configuredRounds = Number(getSetting('agent_debate_rounds') ?? '1')
            const debateRounds = payload.debateRounds ?? (Number.isFinite(configuredRounds) ? configuredRounds : 1)
            const requestId = payload.requestId
            const output = await runDecisionAgent(
                {
                    provider,
                    apiKey,
                    baseUrl,
                    model,
                    fastModel,
                    date: payload.date,
                    candidateCodes: payload.candidateCodes,
                    capital: payload.capital,
                    riskLevel: payload.riskLevel,
                    debateRounds,
                },
                // 逐节点进度回调 → 推送给渲染层做实时提示
                (progress) => {
                    if (requestId && !event.sender.isDestroyed()) {
                        event.sender.send('ai:agentDecision:progress', { requestId, ...progress })
                    }
                }
            )
            const savedDecisionId = saveDecision({
                decisionDate: payload.date,
                marketContext: output.marketContext,
                decisionText: output.decision,
                structuredDecision: output.structuredDecision,
                diagnostics: output.diagnostics,
                capital: payload.capital,
                riskLevel: payload.riskLevel,
                marketRegime: output.marketRegime,
            })
            return { ...output, savedDecisionId }
        }
    )

    // --- 决策记忆 + 命中追踪 ---
    ipcMain.handle('decision:list', (_e, limit?: number) => {
        const list = getDecisions(limit ?? 30)
        return list.map((d) => ({ ...d, picks: getPickReviewsByDecisionId(d.id) }))
    })

    ipcMain.handle('decision:getById', (_e, id: number) => {
        const d = getDecisionById(id)
        return d ? { ...d, picks: getPickReviewsByDecisionId(id) } : null
    })

    ipcMain.handle('decision:stats', (_e, days?: number) => getDecisionStats(days ?? 30))

    ipcMain.handle('decision:scorecard', (_e, days?: number) => getDecisionScorecard(days ?? 90))

    // --- 策略回测 ---
    ipcMain.handle('backtest:strategies', () => STRATEGIES)
    ipcMain.handle(
        'backtest:run',
        (
            _e,
            input: {
                code: string
                name: string
                strategy: StrategyId
                params?: Record<string, number>
                days?: number
            }
        ) => runBacktest(input)
    )

    ipcMain.handle('decision:review', async (_e, decisionId?: number) => {
        if (decisionId != null) return reviewDecision(decisionId)
        return runPendingDecisionReviews()
    })

    ipcMain.handle('decision:delete', (_e, id: number) => {
        deleteDecision(id)
        return true
    })

    // --- AI Chat 会话管理 ---
    ipcMain.handle('chat:listSessions', () => listChatSessions())

    ipcMain.handle('chat:createSession', (_e, title?: string) => {
        const id = randomUUID()
        return createChatSession(id, title?.trim() || '新对话')
    })

    ipcMain.handle('chat:renameSession', (_e, id: string, title: string) => {
        renameChatSession(id, title)
        return listChatSessions().find((s) => s.id === id) ?? null
    })

    ipcMain.handle('chat:deleteSession', (_e, id: string) => {
        deleteChatSession(id)
        return true
    })

    ipcMain.handle('chat:getMessages', (_e, sessionId: string) => listChatMessages(sessionId))

    /**
     * 从 checkpointer 恢复消息：用于 UI 侧 chat_messages 表意外为空的兜底
     * （chat_messages 是"UI 展示视图"，checkpointer 才是"Agent 权威状态"）
     */
    ipcMain.handle('chat:restoreFromCheckpoint', async (_e, sessionId: string) => {
        return getSessionMessagesFromCheckpoint(sessionId)
    })

    // --- AI Chat（流式 + LangGraph checkpointer） ---
    // 每个流式请求维护一个 AbortController，`ai:chat:stop` 时终止 Agent 执行
    const activeAborts = new Map<string, AbortController>()

    ipcMain.on(
        'ai:chat:start',
        async (
            event,
            payload: {
                sessionId: string
                input: string
                requestId: string
                images?: ImageContent[]
            }
        ) => {
            const sender = event.sender
            const { requestId, sessionId, input, images } = payload
            const controller = new AbortController()
            activeAborts.set(requestId, controller)
            let userMessageId: number | null = null
            let assistantMessageId: number | null = null

            const cleanupAbort = () => activeAborts.delete(requestId)

            try {
                const { provider, apiKey, baseUrl, model } = getConfiguredAI()
                if (!input?.trim() && (!images || images.length === 0)) {
                    sender.send('ai:chat:error', { requestId, error: '输入不能为空' })
                    return
                }
                if (!sessionId) {
                    sender.send('ai:chat:error', { requestId, error: '缺少 sessionId' })
                    return
                }

                // 自动降级：当模型不支持视觉时，用视觉模型分析图片转为文字描述
                let processedInput = input
                let visionAnalysis = ''
                if (images && images.length > 0) {
                    const effectiveModel = model || ''
                    if (!modelSupportsVision(effectiveModel)) {
                        // 通知前端正在分析图片
                        if (!sender.isDestroyed()) {
                            sender.send('ai:chat:analyzing', { requestId, message: '正在分析图片...' })
                        }
                        try {
                            visionAnalysis = await analyzeImagesWithVision(
                                provider,
                                apiKey,
                                baseUrl,
                                images,
                                controller.signal
                            )
                            // 将图片描述作为上下文追加到用户输入
                            processedInput = `${input}\n\n【图片分析】用户上传了${images.length}张图片，分析结果如下：\n${visionAnalysis}`
                        } catch (visionErr) {
                            // 视觉降级失败，继续尝试直接发送
                            console.warn('视觉降级分析失败，将尝试直接发送:', visionErr)
                            processedInput = `${input}\n\n【用户上传了${images.length}张图片】`
                        }
                    }
                }

                // 先把用户消息落到 chat_messages（展示表）
                userMessageId = appendChatMessage(sessionId, 'user', input, undefined, images)

                // 如果这是首条 user 消息，用它前 20 字自动生成 title
                const existing = listChatMessages(sessionId)
                if (existing.length === 1) {
                    const auto = input.trim().replace(/\s+/g, ' ').slice(0, 20) || '图片对话'
                    if (auto) renameChatSession(sessionId, auto)
                }
                touchChatSession(sessionId)

                const profile = getInvestorProfile()
                // 如果已做视觉降级，用处理后的文本；否则用原始输入+图片
                const hasVisionFallback = visionAnalysis !== ''
                const result = await runResearchAgent(
                    {
                        provider,
                        apiKey,
                        baseUrl,
                        model,
                        sessionId,
                        input: processedInput,
                        images: hasVisionFallback ? undefined : images,
                        userProfile: formatInvestorProfile(profile),
                        abortSignal: controller.signal,
                    },
                    (chunk: string) => {
                        if (!sender.isDestroyed()) {
                            sender.send('ai:chat:chunk', { requestId, chunk })
                        }
                    }
                )

                // 落库助手回复（含被 stop 时保留的部分内容）
                if (result.content.trim()) {
                    assistantMessageId = appendChatMessage(
                        sessionId,
                        'assistant',
                        result.content,
                        result.toolCalls
                    )
                }
                touchChatSession(sessionId)

                if (!sender.isDestroyed()) {
                    sender.send('ai:chat:done', {
                        requestId,
                        toolCalls: result.toolCalls,
                        aborted: !!result.aborted,
                    })
                }
            } catch (e) {
                const isAbort =
                    (e instanceof Error && e.name === 'AbortError') || controller.signal.aborted
                if (isAbort) {
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('ai:chat:done', {
                            requestId,
                            toolCalls: [],
                            aborted: true,
                        })
                    }
                } else {
                    if (assistantMessageId !== null) {
                        deleteChatMessage(assistantMessageId)
                    }
                    if (userMessageId !== null) {
                        deleteChatMessage(userMessageId)
                    }
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('ai:chat:error', {
                            requestId,
                            error: formatChatError(e),
                        })
                    }
                }
            } finally {
                cleanupAbort()
            }
        }
    )

    ipcMain.on('ai:chat:stop', (_e, payload: { requestId: string }) => {
        const controller = activeAborts.get(payload.requestId)
        if (controller) controller.abort()
    })
}
