import { ipcMain, BrowserWindow } from 'electron'
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
} from '../db'
import {
    fetchQuote,
    fetchBatchQuotes,
    fetchKLine,
    fetchWeeklyKLine,
    fetchIntraday,
    fetchMarketNews,
    fetchTopSectors,
    fetchDynamicCandidates,
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
import { runResearchAgent } from '../services/researchAgent'

function getConfiguredAI() {
    const preferred = (getSetting('ai_provider') ?? 'deepseek') as AIProvider
    const fallbackOrder: AIProvider[] = [preferred, 'ernie', 'qwen', 'deepseek', 'openai']
    const providers = Array.from(new Set(fallbackOrder))

    for (const provider of providers) {
        const apiKey = getSetting(`ai_key_${provider}`) ?? ''
        if (apiKey.trim()) {
            const baseUrl = getSetting(`ai_base_url_${provider}`)?.trim() || undefined
            const model = getSetting(`ai_model_${provider}`)?.trim() || undefined
            return { provider, apiKey: apiKey.trim(), baseUrl, model }
        }
    }

    throw new Error('请先在设置中配置 AI API Key')
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

    ipcMain.handle(
        'ai:marketContext',
        async (
            _e,
            payload: {
                news: string[]
                date: string
                topSectors?: Array<{ name: string; changePercent: number }>
            }
        ) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()
            const messages = buildMarketContextPrompt(
                payload.news,
                payload.date,
                payload.topSectors
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

    // --- AI Chat（工具调用 Agent，流式）---
    ipcMain.on(
        'ai:chat:start',
        async (
            event,
            payload: {
                messages: Array<{ role: string; content: string }>
                requestId: string
            }
        ) => {
            const sender = event.sender
            const { requestId } = payload
            try {
                const { provider, apiKey, baseUrl, model } = getConfiguredAI()
                const allMessages = payload.messages.filter(
                    (m) => m.role === 'user' || m.role === 'assistant'
                )
                const lastMsg = allMessages[allMessages.length - 1]
                if (!lastMsg || lastMsg.role !== 'user') {
                    sender.send('ai:chat:error', { requestId, error: '最后一条消息必须是用户消息' })
                    return
                }
                const profile = getInvestorProfile()
                const result = await runResearchAgent(
                    {
                        provider,
                        apiKey,
                        baseUrl,
                        model,
                        input: lastMsg.content,
                        history: allMessages.slice(0, -1),
                        userProfile: formatInvestorProfile(profile),
                    },
                    (chunk: string) => {
                        if (!sender.isDestroyed()) {
                            sender.send('ai:chat:chunk', { requestId, chunk })
                        }
                    }
                )
                if (!sender.isDestroyed()) {
                    sender.send('ai:chat:done', { requestId, toolCalls: result.toolCalls })
                }
            } catch (e) {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('ai:chat:error', {
                        requestId,
                        error: e instanceof Error ? e.message : String(e),
                    })
                }
            }
        }
    )

    // --- AI Chat（工具调用 Agent）---
    // 前端传来完整历史（含本轮），这里把最后一条 user 消息作为 input，其余作为 history。
    ipcMain.handle(
        'ai:chat',
        async (
            _e,
            payload: {
                messages: Array<{ role: string; content: string }>
            }
        ) => {
            const { provider, apiKey, baseUrl, model } = getConfiguredAI()
            const allMessages = payload.messages.filter(
                (m) => m.role === 'user' || m.role === 'assistant'
            )
            const lastMsg = allMessages[allMessages.length - 1]
            if (!lastMsg || lastMsg.role !== 'user') {
                throw new Error('最后一条消息必须是用户消息')
            }
            const profile = getInvestorProfile()
            return runResearchAgent({
                provider,
                apiKey,
                baseUrl,
                model,
                input: lastMsg.content,
                history: allMessages.slice(0, -1),
                userProfile: formatInvestorProfile(profile),
            })
        }
    )
}
