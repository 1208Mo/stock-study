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

// 热门板块近7日趋势（成分股归一化聚合走势）
export interface SectorTrendItem {
    code: string
    name: string
    changePercent: number // 今日涨跌幅（%）
    return7d: number // 7日累计涨幅（%）
    klines: KLineData[] // 归一化走势（首日 close=100）
    leaderName: string // 成交额第一的成分股名称（代表股）
}

export interface HoldingTrade {
    id: number
    holding_id: number
    trade_type: 'buy' | 'sell'
    cost_price: number
    quantity: number
    trade_date: string
    note: string
}

export interface Holding {
    id: number
    code: string
    name: string
    sector?: string
    sub_sector?: string
    cost_price: number
    avg_cost_price?: number
    quantity: number
    created_at: string
    updated_at: string
    trades?: HoldingTrade[]
}

export interface WatchItem {
    id: number
    code: string
    name: string
    sector?: string
    sub_sector?: string
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
    planText?: string
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

// ===== 市场状态判断（marketRegime）=====

export type MarketRegimeType = 'offensive' | 'defensive' | 'cash'

export interface IndexIndicators {
    name: string
    code: string
    price: number | null
    todayChangePct: number | null
    ma5: number | null
    ma20: number | null
    aboveMa20: boolean | null
    ma5AboveMa20: boolean | null
    ret5d: number | null
    ret20d: number | null
    volumeRatio: number | null
}

export interface MarketRegime {
    regime: MarketRegimeType
    score: number
    indicators: {
        shIndex: IndexIndicators
        szIndex: IndexIndicators
    }
    rationale: string
    suggestedMaxPositionRatio: number
    suggestedCandidateCount: number
}

// ===== 个股基本面（get_fundamentals）=====

export interface FundamentalsHistoryItem {
    reportDate: string
    reportType: string
    roe: number | null
    grossMargin: number | null
    netMargin: number | null
    revenueYoy: number | null
    profitYoy: number | null
}

export interface StockFundamentals {
    code: string
    name: string
    price: number | null
    reportDate: string | null
    reportType: string | null
    pe: number | null
    peEpsYear: string | null
    pb: number | null
    roe: number | null
    grossMargin: number | null
    netMargin: number | null
    revenueYoy: number | null
    profitYoy: number | null
    revenueYi: number | null
    netProfitYi: number | null
    eps: number | null
    bps: number | null
    opCashFlowPerShare: number | null
    debtRatio: number | null
    history: FundamentalsHistoryItem[]
    fetchedAt: string
}

export interface AmbushSector {
    code: string
    name: string
    changePercent: number
    return5d: number
    return10d: number
    volumeTrend: number
    consolidation: number
    distanceToHigh: number
    score: number
    reasons: string[]
}

// 单日资金流向（日K中的一条）
export interface CapitalFlowDaily {
    date: string
    mainNet: number
    smallNet: number
    mediumNet: number
    largeNet: number
    superLargeNet: number
    mainPct: number
    close: number
    changePercent: number
}

// 大盘当日资金流向快照
export interface MarketFlowSnapshot {
    name: string
    code: string
    changePercent: number
    mainNet: number
    superLargeNet: number
    largeNet: number
    mediumNet: number
    smallNet: number
    mainPct: number
}

// 行业板块资金流向排行（单条）
export interface SectorCapitalFlow {
    code: string
    name: string
    changePercent: number
    mainNet: number
    mainPct: number
    superLargeNet: number
    largeNet: number
    mediumNet: number
    smallNet: number
}

// 资金流图当前选中的标的
export interface FlowChartTarget {
    label: string
    code: string
    market?: 'sh' | 'sz'
    kind: 'index' | 'stock' | 'etf'
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
                    quantity: number,
                    sector?: string,
                    subSector?: string
                ) => Promise<unknown>
                update: (id: number, costPrice: number, quantity: number) => Promise<unknown>
                updateSector: (id: number, sector: string, subSector: string) => Promise<unknown>
                delete: (id: number) => Promise<unknown>
                addTrade: (
                    holdingId: number,
                    tradeType: 'buy' | 'sell',
                    costPrice: number,
                    quantity: number,
                    note?: string
                ) => Promise<{ newQuantity: number; newAvgCost: number }>
                getTrades: (holdingId: number) => Promise<HoldingTrade[]>
            }
            watchlist: {
                getAll: () => Promise<WatchItem[]>
                add: (
                    code: string,
                    name: string,
                    note?: string,
                    sector?: string,
                    subSector?: string
                ) => Promise<unknown>
                updateSector: (id: number, sector: string, subSector: string) => Promise<unknown>
                remove: (id: number) => Promise<unknown>
                getGroups: () => Promise<string[]>
                addGroup: (name: string) => Promise<unknown>
                removeGroup: (name: string) => Promise<unknown>
                setItemGroup: (itemId: number, groupName: string) => Promise<unknown>
                getItemGroups: () => Promise<Array<[number, string]>>
            }
            market: {
                getQuote: (code: string) => Promise<QuoteData>
                getBatchQuotes: (codes: string[]) => Promise<QuoteData[]>
                getKLine: (code: string, days?: number) => Promise<KLineData[]>
                getWeeklyKLine: (code: string, weeks?: number) => Promise<KLineData[]>
                getMonthlyKLine: (code: string, months?: number) => Promise<KLineData[]>
                getIntraday: (code: string, bars?: number) => Promise<KLineData[]>
                getNews: (count?: number) => Promise<string[]>
                getTopSectors: (
                    topN?: number
                ) => Promise<Array<{ name: string; code: string; changePercent: number }>>
                getTopSectorTrends: (
                    topN?: number,
                    days?: number
                ) => Promise<SectorTrendItem[]>
                getDynamicCandidates: (
                    topSectorCount?: number,
                    perSector?: number
                ) => Promise<Array<{ code: string; name: string }>>
                getAmbushSectors: (limit?: number) => Promise<AmbushSector[]>
                search: (keyword: string) => Promise<{ code: string; name: string }[]>
                getSectorInfo: (code: string) => Promise<{ sector: string; subSector: string }>
                getSectorKLine: (bkCode: string, days?: number) => Promise<KLineData[]>
                getDividends: (code: string) => Promise<DividendRecord[]>
                getCapitalFlowDaily: (
                    code: string,
                    days?: number,
                    market?: 'sh' | 'sz'
                ) => Promise<CapitalFlowDaily[]>
                getDailyKLine: (
                    code: string,
                    days?: number,
                    market?: 'sh' | 'sz'
                ) => Promise<KLineData[]>
                getSectorCapitalFlow: (topN?: number) => Promise<SectorCapitalFlow[]>
                getMarketFlowSnapshot: () => Promise<MarketFlowSnapshot[]>
                getSectorTopStocks: (
                    bkCode: string,
                    topN?: number
                ) => Promise<Array<{ code: string; name: string; changePercent: number }>>
                getFundamentals: (code: string) => Promise<StockFundamentals>
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
                    ambushSectors?: Array<{
                        name: string
                        changePercent: number
                        return5d: number
                        return10d: number
                        volumeTrend: number
                        distanceToHigh: number
                        reasons: string[]
                    }>
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
                    marketRegime: MarketRegime | null
                    savedDecisionId?: number
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
                    payload: { sessionId: string; input: string; images?: ImageContent[] },
                    requestId: string
                ) => void
                chatStop: (requestId: string) => void
                onChatChunk: (cb: (data: { requestId: string; chunk: string }) => void) => () => void
                onChatDone: (
                    cb: (data: {
                        requestId: string
                        toolCalls: ResearchToolTrace[]
                        aborted?: boolean
                    }) => void
                ) => () => void
                onChatError: (cb: (data: { requestId: string; error: string }) => void) => () => void
                onChatAnalyzing: (cb: (data: { requestId: string; message: string }) => void) => () => void
            }
            chat: {
                listSessions: () => Promise<ChatSessionMeta[]>
                createSession: (title?: string) => Promise<ChatSessionMeta>
                renameSession: (id: string, title: string) => Promise<ChatSessionMeta | null>
                deleteSession: (id: string) => Promise<boolean>
                getMessages: (sessionId: string) => Promise<ChatMessageRow[]>
                restoreFromCheckpoint: (
                    sessionId: string
                ) => Promise<Array<{ role: 'user' | 'assistant'; content: string }>>
            }
            decision: {
                list: (limit?: number) => Promise<DecisionHistoryWithPicks[]>
                getById: (id: number) => Promise<DecisionHistoryWithPicks | null>
                stats: (days?: number) => Promise<DecisionStats>
                review: (
                    decisionId?: number
                ) => Promise<{ decisions?: number; reviewed: number; failed: number }>
                delete: (id: number) => Promise<boolean>
            }
        }
    }
}

export interface ChatSessionMeta {
    id: string
    title: string
    created_at: string
    updated_at: string
}

export interface ChatMessageRow {
    id: number
    session_id: string
    role: string
    content: string
    tool_calls: string | null
    images: string | null
    created_at: string
}

export interface ImageContent {
    id: string
    dataUrl: string
    name: string
    type: string
}

// ===== 决策记忆 + 命中追踪 =====

export interface DecisionPickReviewFront {
    id: number
    decision_id: number
    code: string
    name: string
    priority: number | null
    action: 'watch' | 'avoid' | null
    aggressive_entry: number | null
    conservative_entry: number | null
    stop_loss: number | null
    take_profit: number | null
    position_amount: number | null
    status: 'pending' | 'reviewed' | 'failed'
    review_date: string | null
    entry_triggered: 0 | 1
    entry_type: 'aggressive' | 'conservative' | null
    entry_price: number | null
    entry_date: string | null
    exit_reason: string | null
    exit_price: number | null
    exit_date: string | null
    return_pct: number | null
    pnl_amount: number | null
    kline_snapshot: string | null
    error_msg: string | null
    reviewed_at: string | null
}

export interface DecisionHistoryWithPicks {
    id: number
    decision_date: string
    market_context: string
    decision_text: string
    structured_decision: string | null
    diagnostics: string | null
    capital: number | null
    risk_level: string | null
    review_status: 'pending' | 'partial' | 'reviewed'
    market_regime: string | null
    created_at: string
    picks: DecisionPickReviewFront[]
}

export interface DecisionStats {
    decision_count: number
    pick_total: number
    actionable_count: number
    entry_triggered_count: number
    closed_count: number
    profitable_count: number
    trigger_rate: number
    win_rate: number
    avg_return_pct: number | null
    total_pnl: number
}
