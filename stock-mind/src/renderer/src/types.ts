// Type declarations for window.api (exposed by preload)
export interface QuoteData {
    code: string
    name: string
    price: number
    change: number
    changePercent: number
    open: number
    high: number
    low: number
    volume: number
    amount: number
    timestamp: string
}

export interface KLineData {
    date: string
    open: number
    close: number
    low: number
    high: number
    volume: number
}

export interface Holding {
    id: number
    code: string
    name: string
    cost_price: number
    quantity: number
    created_at: string
    updated_at: string
}

export interface WatchItem {
    id: number
    code: string
    name: string
    note: string
    created_at: string
}

export interface AIAnalysis {
    id: number
    code: string
    model: string
    prompt: string
    result: string
    created_at: string
}

export interface DividendRecord {
    year: string
    reportDate: string
    divPerShare: number
    exDivDate: string
    recordDate: string
}

export interface DailyDecisionCandidate {
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
}

export interface StructuredDecisionPick {
    priority: number
    action: 'watch' | 'avoid'
    code: string
    name: string
    reason: string
    aggressiveEntry: number | null
    conservativeEntry: number | null
    stopLoss: number | null
    takeProfit: number | null
    positionAmount: number
    noBuyCondition: string
    riskNote: string
}

export interface StructuredDecision {
    summary: string
    marketBias: 'positive' | 'neutral' | 'negative'
    maxPositionPerTarget: number
    observeReason: string | null
    picks: StructuredDecisionPick[]
}

export interface ResearchToolTrace {
    name: string
    args: Record<string, unknown>
    ok: boolean
    preview: string
}

export interface InvestorProfile {
    capital: number | null
    riskLevel: string
    preferredTypes: string
    avoidTypes: string
    preferredSectors: string
    notes: string
    updatedAt: string
}

export interface AgentDiagnostics {
    discoveredCandidates: Array<{ code: string; name: string }>
    filterNotes: string[]
    riskWarnings: string[]
    validationIssues: string[]
    workflowNotes: string[]
    quoteCount: number
    filteredQuoteCount: number
}

declare global {
    interface Window {
        api: {
            holdings: {
                getAll: () => Promise<Holding[]>
                add: (
                    code: string,
                    name: string,
                    costPrice: number,
                    quantity: number
                ) => Promise<unknown>
                update: (id: number, costPrice: number, quantity: number) => Promise<unknown>
                delete: (id: number) => Promise<unknown>
            }
            watchlist: {
                getAll: () => Promise<WatchItem[]>
                add: (code: string, name: string, note?: string) => Promise<unknown>
                remove: (id: number) => Promise<unknown>
            }
            market: {
                getQuote: (code: string) => Promise<QuoteData>
                getBatchQuotes: (codes: string[]) => Promise<QuoteData[]>
                getKLine: (code: string, days?: number) => Promise<KLineData[]>
                getWeeklyKLine: (code: string, weeks?: number) => Promise<KLineData[]>
                getIntraday: (code: string, bars?: number) => Promise<KLineData[]>
                getNews: (count?: number) => Promise<string[]>
                getTopSectors: (
                    topN?: number
                ) => Promise<Array<{ name: string; code: string; changePercent: number }>>
                getDynamicCandidates: (
                    topSectorCount?: number,
                    perSector?: number
                ) => Promise<Array<{ code: string; name: string }>>
                search: (keyword: string) => Promise<{ code: string; name: string }[]>
                getSectorInfo: (code: string) => Promise<{ sector: string; subSector: string }>
                getSectorKLine: (bkCode: string, days?: number) => Promise<KLineData[]>
                getDividends: (code: string) => Promise<DividendRecord[]>
            }
            settings: {
                get: (key: string) => Promise<string | null>
                set: (key: string, value: string) => Promise<unknown>
            }
            memory: {
                getInvestorProfile: () => Promise<InvestorProfile>
                updateInvestorProfile: (
                    payload: Partial<Omit<InvestorProfile, 'updatedAt'>>
                ) => Promise<InvestorProfile>
            }
            ai: {
                analyze: (
                    code: string,
                    name: string,
                    price: number,
                    changePercent: number
                ) => Promise<{ content: string; model: string; provider: string }>
                dailyDecision: (payload: {
                    capital: number
                    riskLevel: string
                    focus: string
                    candidates: DailyDecisionCandidate[]
                }) => Promise<{ content: string; model: string; provider: string }>
                getHistory: (code: string) => Promise<AIAnalysis[]>
                readKLine: (payload: {
                    code: string
                    name: string
                    currentPrice: number
                    changePercent: number
                    klines: KLineData[]
                }) => Promise<{ content: string; model: string; provider: string }>
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
                    intraday: KLineData[]
                }) => Promise<{ content: string; model: string; provider: string }>
                marketContext: (payload: {
                    news: string[]
                    date: string
                    topSectors?: Array<{ name: string; changePercent: number }>
                }) => Promise<{ content: string; model: string; provider: string }>
                agentDecision: (payload: {
                    date: string
                    candidateCodes: Array<{ code: string; name: string }>
                    capital?: number
                    riskLevel?: string
                }) => Promise<{
                    marketContext: string
                    decision: string
                    structuredDecision: StructuredDecision | null
                    quotes?: QuoteData[]
                    diagnostics: AgentDiagnostics
                }>
                chat: (payload: {
                    messages: Array<{ role: string; content: string }>
                }) => Promise<{
                    content: string
                    model: string
                    provider: string
                    toolCalls?: ResearchToolTrace[]
                }>
                chatStream: (
                    payload: { messages: Array<{ role: string; content: string }> },
                    requestId: string
                ) => void
                onChatChunk: (cb: (data: { requestId: string; chunk: string }) => void) => () => void
                onChatDone: (
                    cb: (data: { requestId: string; toolCalls: ResearchToolTrace[] }) => void
                ) => () => void
                onChatError: (cb: (data: { requestId: string; error: string }) => void) => () => void
            }
        }
    }
}
