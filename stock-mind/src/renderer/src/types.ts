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
    // 多智能体产物：多头论据、空头论据、风控官裁决
    bullResearch?: string
    bearResearch?: string
    riskVerdicts?: string[]
    // 分析师层报告：技术面 / 基本面 / 消息面
    technicalAnalysis?: string
    fundamentalAnalysis?: string
    newsAnalysis?: string
    // 多空辩论逐轮记录
    debateHistory?: DebateTurn[]
    debateRounds?: number
}

export interface DebateTurn {
    round: number
    side: 'bull' | 'bear'
    content: string
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
    price: number
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

// ===== 市场总览（首页）=====

export interface IndexTick {
    code: string
    name: string
    price: number
    change: number
    changePercent: number
}

export interface LimitUpStock {
    code: string
    name: string
    boards: number
    industry: string
    firstSealTime: string
}

export interface BreadthTick {
    time: string
    up: number
    down: number
}

export interface MarketBreadth {
    up: number | null
    down: number | null
    flat: number | null
    intraday: BreadthTick[]
    limitUp: number
    limitDown: number
    brokenBoard: number
    sealRate: number | null
    ladder: Array<{ boards: number; stocks: LimitUpStock[] }>
    tradeDate: string | null
}

export interface SectorHeatItem {
    code: string
    name: string
    changePercent: number
    amount: number
    leader: string
    upCount: number | null
    downCount: number | null
}

export interface NewsFlashItem {
    id: string
    title: string
    digest: string
    time: string
    url: string
}

// ===== 个股新闻与公告 =====

export interface StockNewsItem {
    id: string
    kind: 'news' | 'notice'
    title: string
    summary: string
    source: string
    time: string
    url: string
}

export interface NewsSentiment {
    id: string
    sentiment: 'positive' | 'negative' | 'neutral'
    reason: string
}

// ===== 持仓收益分析 =====

export interface PortfolioHistoryPoint {
    date: string
    marketValue: number
    netInvested: number
    pnl: number
    returnPct: number
    benchmarkPct: number
}

export interface PositionAnalytics {
    code: string
    name: string
    sector: string
    quantity: number
    avgCost: number
    price: number
    marketValue: number
    weight: number
    unrealizedPnl: number
    unrealizedPct: number
    realizedPnl: number
    todayPct: number
}

export interface PortfolioAnalytics {
    benchmarkName: string
    history: PortfolioHistoryPoint[]
    positions: PositionAnalytics[]
    sectors: Array<{ name: string; marketValue: number; weight: number }>
    totals: {
        marketValue: number
        unrealizedPnl: number
        realizedPnl: number
        totalPnl: number
        returnPct: number | null
        benchmarkPct: number | null
        maxDrawdownPct: number | null
        sellCount: number
        winningSells: number
    }
    warnings: Array<{ level: 'high' | 'medium'; text: string }>
    generatedAt: string
}

// ===== 策略回测 =====

export type StrategyId = 'ma_cross' | 'breakout' | 'rsi_reversal' | 'stop_profit_loss'

export interface StrategyMeta {
    id: StrategyId
    name: string
    description: string
    params: Array<{ key: string; label: string; default: number; min: number; max: number; step: number }>
}

export interface BacktestTrade {
    entryDate: string
    entryPrice: number
    exitDate: string | null
    exitPrice: number | null
    exitReason: string
    returnPct: number
    holdDays: number
    open: boolean
}

export interface EquityPoint {
    date: string
    strategy: number
    benchmark: number
}

export interface BacktestResult {
    code: string
    capital: number
    name: string
    strategy: StrategyId
    strategyName: string
    params: Record<string, number>
    startDate: string
    endDate: string
    barCount: number
    totalReturnPct: number
    benchmarkReturnPct: number
    annualizedPct: number | null
    maxDrawdownPct: number
    tradeCount: number
    winRate: number | null
    avgReturnPct: number | null
    avgHoldDays: number | null
    bestTradePct: number | null
    worstTradePct: number | null
    exposurePct: number
    totalFee: number
    trades: BacktestTrade[]
    equity: EquityPoint[]
    verdict: string
}

// ===== AI 战绩切片 =====

export interface ScorecardSlice {
    key: string
    label: string
    actionable: number
    triggered: number
    closed: number
    wins: number
    winRate: number | null
    avgReturnPct: number | null
    totalPnl: number
}

export interface ScorecardPick {
    decisionDate: string
    regime: string | null
    code: string
    name: string
    priority: number | null
    entryPrice: number | null
    exitReason: string | null
    returnPct: number | null
}

export interface DecisionScorecard {
    days: number
    overall: ScorecardSlice
    byRegime: ScorecardSlice[]
    byPriority: ScorecardSlice[]
    byEntryType: ScorecardSlice[]
    byExitReason: ScorecardSlice[]
    byStock: ScorecardSlice[]
    recent: ScorecardPick[]
}

// ===== 数据源健康状态 =====

export interface DataSourceStatus {
    state: 'unknown' | 'ok' | 'down'
    lastCheckedAt: number
}

// ===== 价格提醒 =====

export type PriceAlertKind = 'price_above' | 'price_below' | 'pct_above' | 'pct_below'

export interface PriceAlert {
    id: number
    code: string
    name: string
    kind: PriceAlertKind
    target: number
    note: string
    source: string
    enabled: number
    repeat_daily: number
    last_triggered_at: string | null
    created_at: string
}

export interface AlertEvent {
    id: number
    alert_id: number | null
    code: string
    name: string
    message: string
    price: number | null
    is_read: number
    created_at: string
}

// 资金流图当前选中的标的
export interface FlowChartTarget {
    label: string
    code: string
    market?: 'sh' | 'sz'
    kind: 'index' | 'stock' | 'etf'
}

// ===== 通用 K 线 =====

export type KLinePeriod = '1m' | '5m' | '15m' | '30m' | '60m' | 'day' | 'week' | 'month'
export type AdjustType = 'none' | 'qfq' | 'hfq'

export interface KLineResult {
    bars: KLineData[]
    source: 'eastmoney' | 'sina'
    adjust: AdjustType
}

// ===== 条件选股 =====

export type PatternId =
    | 'ma_bull'
    | 'above_ma20'
    | 'above_ma60'
    | 'breakout_20'
    | 'breakout_55'
    | 'volume_breakout'
    | 'macd_golden'
    | 'kdj_golden_low'
    | 'pullback_ma20'
    | 'rsi_oversold'
    | 'consecutive_up'
    | 'tight_consolidation'
    | 'bottom_divergence'
    | 'td9_buy'

export interface PatternMeta {
    id: PatternId
    name: string
    description: string
    minBars: number
}

export interface StockSnapshot {
    code: string
    name: string
    price: number | null
    changePercent: number | null
    amount: number | null
    turnover: number | null
    volumeRatio: number | null
    pe: number | null
    pb: number | null
    totalMv: number | null
    floatMv: number | null
    change60d: number | null
    changeYtd: number | null
    industry: string
}

export type NumericField = Exclude<keyof StockSnapshot, 'code' | 'name' | 'industry'>
export type Board = 'sh_main' | 'sz_main' | 'cyb' | 'kcb' | 'bj'

export interface ScreenerCriteria {
    scope: { type: 'all' } | { type: 'sector'; code: string; name?: string } | { type: 'codes'; codes: string[] }
    ranges?: Partial<Record<NumericField, { min?: number | null; max?: number | null }>>
    boards?: Board[]
    excludeST?: boolean
    excludeSuspended?: boolean
    patterns?: PatternId[]
    patternMode?: 'all' | 'any'
    maxScan?: number
    sortBy?: NumericField
    sortDir?: 'asc' | 'desc'
    limit?: number
}

export interface ScreenerRow extends StockSnapshot {
    board: Board
    patternHits: Array<{ id: PatternId; reason: string }>
}

export interface ScreenerResult {
    rows: ScreenerRow[]
    universe: number
    afterFilter: number
    scanned: number
    scanFailed: number
    source: 'eastmoney' | 'sina'
    truncated: boolean
    cancelled: boolean
    elapsedMs: number
    ignoredFilters: NumericField[]
}

export interface ScreenerPreset {
    id: string
    name: string
    description: string
    criteria: Omit<ScreenerCriteria, 'scope'>
    builtin?: boolean
}

// ===== 技术信号监控 =====

export type SignalId = string

export interface SignalMeta {
    id: SignalId
    name: string
    direction: 'buy' | 'sell'
    description: string
}

export interface SignalWatch {
    id: number
    code: string
    name: string
    periods: string
    signals: string
    enabled: number
    note: string
    last_scanned_at: string | null
    created_at: string
}

export interface SignalEvent {
    id: number
    code: string
    name: string
    period: string
    signal_id: string
    signal_name: string
    direction: 'buy' | 'sell'
    bar_time: string
    price: number
    detail: string
    is_read: number
    created_at: string
}

export interface SignalDefaults {
    periods: KLinePeriod[]
    signals: SignalId[]
    enabled: boolean
}

export interface SignalStatsSlice {
    key: string
    label: string
    trades: number
    closed: number
    wins: number
    winRate: number | null
    avgReturnPct: number | null
    cumReturnPct: number
    open: number
}

export interface SignalRoundTrip {
    code: string
    name: string
    period: string
    entryTime: string
    entryPrice: number
    exitTime: string | null
    exitPrice: number | null
    returnPct: number | null
    floatingPct: number | null
}

export interface SignalStats {
    since: string | null
    overall: SignalStatsSlice
    byStock: SignalStatsSlice[]
    byPeriod: SignalStatsSlice[]
    trips: SignalRoundTrip[]
}

// ===== 自动更新 =====

export interface UpdateState {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'
    currentVersion: string
    latestVersion: string | null
    releaseNotes: string | null
    progress: number | null
    error: string | null
    canAutoInstall: boolean
    checkedAt: number | null
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
                getKLineEx: (code: string, period?: KLinePeriod, adjust?: AdjustType, limit?: number) => Promise<KLineResult>
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
                getIndexTicker: () => Promise<IndexTick[]>
                getBreadth: () => Promise<MarketBreadth>
                getSectorHeatmap: (topN?: number) => Promise<SectorHeatItem[]>
                getNewsFlash: (count?: number) => Promise<NewsFlashItem[]>
                getRegime: () => Promise<MarketRegime>
                getSectorTopStocks: (
                    bkCode: string,
                    topN?: number
                ) => Promise<Array<{ code: string; name: string; changePercent: number }>>
                getFundamentals: (code: string) => Promise<StockFundamentals>
            }
            stock: {
                news: (code: string, count?: number) => Promise<StockNewsItem[]>
                notices: (code: string, count?: number) => Promise<StockNewsItem[]>
                tagSentiment: (
                    stock: { code: string; name: string },
                    items: Array<{ id: string; title: string; summary?: string }>
                ) => Promise<NewsSentiment[]>
            }
            backtest: {
                strategies: () => Promise<StrategyMeta[]>
                run: (input: {
                    code: string
                    name: string
                    strategy: StrategyId
                    params?: Record<string, number>
                    days?: number
                }) => Promise<BacktestResult>
            }
            portfolio: {
                analytics: (days?: number) => Promise<PortfolioAnalytics>
            }
            screener: {
                meta: () => Promise<{ patterns: PatternMeta[]; presets: ScreenerPreset[] }>
                run: (criteria: ScreenerCriteria, requestId?: string) => Promise<ScreenerResult>
                cancel: (requestId: string) => Promise<void>
                onProgress: (
                    cb: (data: { requestId?: string; done: number; total: number; hits: number }) => void
                ) => () => void
            }
            signals: {
                meta: () => Promise<{ signals: SignalMeta[]; periods: KLinePeriod[]; defaults: SignalDefaults }>
                listWatch: () => Promise<SignalWatch[]>
                addWatch: (items: Array<{ code: string; name: string }>, periods?: string, signals?: string) => Promise<number>
                updateWatch: (
                    id: number,
                    patch: { periods?: string; signals?: string; enabled?: boolean; note?: string }
                ) => Promise<void>
                removeWatch: (id: number) => Promise<void>
                setDefaults: (d: { periods?: string[]; signals?: string[]; enabled?: boolean }) => Promise<SignalDefaults>
                scanNow: () => Promise<{ scanned: number; fired: number }>
                backfill: () => Promise<{ scanned: number; fired: number }>
                events: (q?: {
                    keyword?: string
                    period?: string
                    direction?: 'buy' | 'sell'
                    since?: string
                    until?: string
                    limit?: number
                    offset?: number
                }) => Promise<{ rows: SignalEvent[]; total: number }>
                unreadCount: () => Promise<number>
                markRead: () => Promise<void>
                clearEvents: () => Promise<void>
                stats: (q?: { since?: string; code?: string; period?: string }) => Promise<SignalStats>
                onChanged: (cb: (data: { unread: number }) => void) => () => void
            }
            updater: {
                getState: () => Promise<UpdateState>
                check: () => Promise<UpdateState>
                download: () => Promise<UpdateState>
                install: () => Promise<void>
                openReleases: () => Promise<void>
                onState: (cb: (state: UpdateState) => void) => () => void
            }
            alerts: {
                list: () => Promise<PriceAlert[]>
                add: (input: {
                    code: string
                    name: string
                    kind: PriceAlertKind
                    target: number
                    note?: string
                    source?: string
                    repeatDaily?: boolean
                }) => Promise<PriceAlert>
                setEnabled: (id: number, enabled: boolean) => Promise<void>
                delete: (id: number) => Promise<void>
                events: (limit?: number) => Promise<AlertEvent[]>
                unreadCount: () => Promise<number>
                markRead: () => Promise<void>
                clearEvents: () => Promise<void>
                checkNow: () => Promise<number>
                onChanged: (cb: (data: { unread: number }) => void) => () => void
            }
            backup: {
                export: (
                    kind: 'json' | 'db' | 'holdings-csv' | 'trades-csv',
                    includeChat?: boolean
                ) => Promise<
                    { canceled: true } | { canceled: false; path: string; tables?: number; rows?: number }
                >
                import: () => Promise<
                    | { canceled: true }
                    | { canceled: false; restored: string[]; skipped: string[]; rows: number; exportedAt: string }
                >
                revealDataDir: () => Promise<boolean>
            }
            app: {
                dataSourceStatus: () => Promise<DataSourceStatus>
                probeDataSource: () => Promise<DataSourceStatus>
                setTrayEnabled: (enabled: boolean) => Promise<void>
                onNavigate: (cb: (route: string) => void) => () => void
                onRefresh: (cb: () => void) => () => void
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
                extractStocksFromImage: (payload: {
                    images: ImageContent[]
                }) => Promise<Array<{ code: string; name: string; costPrice?: number; quantity?: number }>>
                agentDecision: (payload: {
                    date: string
                    candidateCodes: Array<{ code: string; name: string }>
                    capital?: number
                    riskLevel?: string
                    requestId?: string
                    debateRounds?: number
                }) => Promise<{
                    marketContext: string
                    decision: string
                    structuredDecision: StructuredDecision | null
                    quotes?: QuoteData[]
                    diagnostics: AgentDiagnostics
                    marketRegime: MarketRegime | null
                    savedDecisionId?: number
                }>
                onAgentProgress: (
                    cb: (data: {
                        requestId: string
                        node: string
                        label: string
                        content?: string
                        round?: number
                    }) => void
                ) => () => void
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
                scorecard: (days?: number) => Promise<DecisionScorecard>
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
