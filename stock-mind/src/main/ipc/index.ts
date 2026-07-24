import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import {
    getAllHoldings,
    addHolding,
    updateHolding,
    deleteHolding,
    getAllWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    getSetting,
    setSetting,
    getInvestorProfile,
    updateInvestorProfile,
    formatInvestorProfile,
    formatInvestorProfileFull,
    saveAnalysis,
    getAnalysesForStock,
    listChatSessions,
    createChatSession,
    renameChatSession,
    touchChatSession,
    deleteChatSession,
    listChatMessages,
    appendChatMessage,
} from '../db'
import {
    fetchQuote,
    fetchBatchQuotes,
    fetchKLine,
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
    searchStock,
} from '../services/market'
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
import { runResearchAgent, getSessionMessagesFromCheckpoint } from '../services/researchAgent'

function getConfiguredAI() {
    const provider = (getSetting('ai_provider') ?? 'deepseek') as AIProvider
    const apiKey = (getSetting(`ai_key_${provider}`) ?? '').trim()
    if (!apiKey) {
        throw new Error(`请先在设置中为"${provider}"配置 API Key`)
    }
    const baseUrl = getSetting(`ai_base_url_${provider}`)?.trim() || undefined
    const model = getSetting(`ai_model_${provider}`)?.trim() || undefined
    return { provider, apiKey, baseUrl, model }
}

export function registerAllIpcHandlers(): void {
    // --- Holdings ---
    ipcMain.handle('holdings:getAll', () => getAllHoldings())

    ipcMain.handle(
        'holdings:add',
        (_e, code: string, name: string, costPrice: number, quantity: number) => {
            return addHolding(code, name, costPrice, quantity)
        }
    )

    ipcMain.handle('holdings:update', (_e, id: number, costPrice: number, quantity: number) => {
        return updateHolding(id, costPrice, quantity)
    })

    ipcMain.handle('holdings:delete', (_e, id: number) => deleteHolding(id))

    // --- Watchlist ---
    ipcMain.handle('watchlist:getAll', () => getAllWatchlist())

    ipcMain.handle('watchlist:add', (_e, code: string, name: string, note?: string) => {
        return addToWatchlist(code, name, note)
    })

    ipcMain.handle('watchlist:remove', (_e, id: number) => removeFromWatchlist(id))

    // --- Market data ---
    ipcMain.handle('market:getQuote', (_e, code: string) => fetchQuote(code))

    ipcMain.handle('market:getBatchQuotes', (_e, codes: string[]) => fetchBatchQuotes(codes))

    ipcMain.handle('market:getKLine', (_e, code: string, days: number) => fetchKLine(code, days))

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

    ipcMain.handle(
        'market:getDynamicCandidates',
        (_e, topSectorCount?: number, perSector?: number) =>
            fetchDynamicCandidates(topSectorCount ?? 5, perSector ?? 4)
    )

    ipcMain.handle('market:getAmbushSectors', (_e, limit?: number) =>
        fetchAmbushSectors(limit ?? 8)
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
            _e,
            payload: {
                date: string
                candidateCodes: Array<{ code: string; name: string }>
                capital?: number
                riskLevel?: string
            }
        ) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()
            const profile = getInvestorProfile()
            return runDecisionAgent({
                provider,
                apiKey,
                baseUrl,
                model,
                date: payload.date,
                candidateCodes: payload.candidateCodes,
                capital: payload.capital,
                riskLevel: payload.riskLevel,
                userProfile: formatInvestorProfileFull(profile),
            })
        }
    )

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
            }
        ) => {
            const sender = event.sender
            const { requestId, sessionId, input } = payload
            const controller = new AbortController()
            activeAborts.set(requestId, controller)

            const cleanupAbort = () => activeAborts.delete(requestId)

            try {
                const { provider, apiKey, baseUrl, model } = getConfiguredAI()
                if (!input?.trim()) {
                    sender.send('ai:chat:error', { requestId, error: '输入不能为空' })
                    return
                }
                if (!sessionId) {
                    sender.send('ai:chat:error', { requestId, error: '缺少 sessionId' })
                    return
                }

                // 先把用户消息落到 chat_messages（展示表）
                appendChatMessage(sessionId, 'user', input)

                // 如果这是首条 user 消息，用它前 20 字自动生成 title
                const existing = listChatMessages(sessionId)
                if (existing.length === 1) {
                    const auto = input.trim().replace(/\s+/g, ' ').slice(0, 20)
                    if (auto) renameChatSession(sessionId, auto)
                }
                touchChatSession(sessionId)

                const profile = getInvestorProfile()
                const result = await runResearchAgent(
                    {
                        provider,
                        apiKey,
                        baseUrl,
                        model,
                        sessionId,
                        input,
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
                    appendChatMessage(sessionId, 'assistant', result.content, result.toolCalls)
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
                } else if (!event.sender.isDestroyed()) {
                    event.sender.send('ai:chat:error', {
                        requestId,
                        error: e instanceof Error ? e.message : String(e),
                    })
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
