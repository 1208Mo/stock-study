import { ipcMain } from 'electron'
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
    formatInvestorProfileFull,
    saveAnalysis,
    getAnalysesForStock,
    saveDecision,
    getDecisions,
    getDecisionById,
    getPickReviewsByDecisionId,
    getDecisionStats,
    deleteDecision,
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
    fetchSectorTopStocks,
    fetchTopSectorTrends,
    searchStock,
} from '../services/market'
import { fetchCapitalFlowDaily, fetchMarketFlowSnapshot, fetchDailyKLine, fetchSectorCapitalFlow } from '../services/capitalFlow'
import { fetchFundamentals } from '../services/fundamentals'
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
import { runResearchAgent, getSessionMessagesFromCheckpoint, modelSupportsVision, analyzeImagesWithVision, type ImageContent } from '../services/researchAgent'
import { reviewDecision, runPendingDecisionReviews } from '../services/decisionReview'

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
            const output = await runDecisionAgent({
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
                appendChatMessage(sessionId, 'user', input, undefined, images)

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
