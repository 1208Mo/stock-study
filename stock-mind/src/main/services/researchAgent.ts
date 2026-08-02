/**
 * 股票研究 Agent - 基于 LangGraph createReactAgent 实现
 *
 * 学习要点（Step 4：接入 LangGraph Checkpointer）：
 * 1. createReactAgent      — 官方 prebuilt 的 ReAct Agent，内置 tool loop，不再手写
 * 2. Checkpointer          — 用 SqlJsCheckpointSaver 做 thread 隔离 + 状态持久化
 * 3. thread_id             — 每个会话一个 id；状态自动按 thread_id 加载/保存
 * 4. streamEvents          — 从统一事件流里同时拿 token 流 (on_chat_model_stream)
 *                            和工具调用轨迹 (on_tool_end)
 * 5. 不再手动传 history    — 历史消息来自 checkpointer，每次只需喂本轮 user 消息
 */

import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import {
    HumanMessage,
    SystemMessage,
    AIMessage,
    ToolMessage,
    isAIMessage,
    isHumanMessage,
    isToolMessage,
} from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import type { AIProvider } from './ai'
import { fetchQuote, fetchKLine, fetchSectorInfo, fetchDividends, searchStock, fetchBatchQuotes } from './market'
import { fetchFundamentals } from './fundamentals'
import { getAllHoldings } from '../db'
import { getChatCheckpointer } from './chatCheckpointer'

const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    ernie: { baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k-preview' },
    volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
    zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2' },
}

// 支持视觉（图片输入）的模型关键词
const VISION_MODEL_KEYWORDS = [
    'gpt-4o', 'gpt-4.1', 'gpt-4-vision', 'vision',
    'claude-3', 'claude-4', 'opus', 'sonnet', 'haiku',
    'gemini', 'flash', 'pro-vision', '1.5-pro', '1.5-flash',
    'qwen-vl', 'qwen-vl-max', 'qwen-vl-plus', 'qwen-vl-long',
    'glm-4v', 'glm-4-flashx', 'glm-4-plus',
    'doubao-vision', 'doubao-pro-vision',
    'ernie-4.5', 'ernie-vil',
    'deepseek-vision',
    'moonshot-v1',
    'hunyuan-vision',
    'minimax',
    'vision', 'vl', 'multimodal',
]

// 不支持视觉的纯文本模型关键词
const TEXT_ONLY_MODEL_KEYWORDS = [
    'deepseek-chat',
    'qwen-turbo', 'qwen-plus', 'qwen-max',
    'glm-5.2', 'glm-4', 'glm-3', 'glm-pro',
    'ernie-bot', 'ernie-4.0',
    'gpt-3.5',
    'claude-2',
]

/**
 * 检测模型是否支持视觉/图片输入能力
 */
export function modelSupportsVision(model: string): boolean {
    const lower = model.toLowerCase().trim()
    if (!lower) return false

    // 先检查明确的纯文本模型
    for (const keyword of TEXT_ONLY_MODEL_KEYWORDS) {
        if (lower.includes(keyword)) return false
    }

    // 再检查支持视觉的模型关键词
    for (const keyword of VISION_MODEL_KEYWORDS) {
        if (lower.includes(keyword)) return true
    }

    // 不确定时默认不支持（安全策略）
    return false
}

/**
 * 获取支持视觉的模型推荐
 */
export function getVisionModelSuggestion(provider: AIProvider): string[] {
    const suggestions: Record<AIProvider, string[]> = {
        openai: ['gpt-4o-mini', 'gpt-4o'],
        deepseek: ['deepseek-vision'],
        qwen: ['qwen-vl-max', 'qwen-vl-plus'],
        ernie: ['ernie-4.5-8k-preview', 'ernie-vil'],
        volcengine: ['doubao-pro-vision', 'doubao-vision'],
        zhipu: ['glm-4v-flash', 'glm-4v-plus'],
    }
    return suggestions[provider] || []
}

/**
 * 自动获取可用于视觉的模型（优先使用推荐列表中的第一个）
 */
export function getAutoVisionModel(provider: AIProvider): string | null {
    const suggestions = getVisionModelSuggestion(provider)
    return suggestions.length > 0 ? suggestions[0] : null
}

/**
 * 用视觉模型分析图片，返回文字描述
 */
export async function analyzeImagesWithVision(
    provider: AIProvider,
    apiKey: string,
    baseUrl: string | undefined,
    images: ImageContent[],
    abortSignal?: AbortSignal
): Promise<string> {
    const visionModel = getAutoVisionModel(provider)
    if (!visionModel) {
        throw new Error('未找到可用的视觉模型')
    }

    const llm = createLLM(provider, apiKey, baseUrl, visionModel)

    const systemPrompt = `你是一个专业的图片分析助手。请用简洁的中文描述这些图片的内容。
如果是股票K线图或走势图，请描述：
1. 图表类型和时间周期
2. 主要走势（上涨/下跌/震荡）
3. 关键价位和技术形态
4. 可见的技术指标信号

如果是其他图片，请客观描述其内容。
请直接返回描述，不要添加开场白。`

    const messageContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
        { type: 'text', text: '请分析这些图片的内容：' }
    ]
    for (const img of images) {
        messageContent.push({
            type: 'image_url',
            image_url: { url: img.dataUrl }
        })
    }

    const response = await llm.invoke(
        [
            new SystemMessage(systemPrompt),
            new HumanMessage({ content: messageContent })
        ],
        abortSignal ? { signal: abortSignal } : {}
    )

    return typeof response.content === 'string'
        ? response.content
        : contentToText(response.content)
}

export interface ImageContent {
    id: string
    dataUrl: string
    name: string
    type: string
}

export interface ResearchAgentInput {
    provider: AIProvider
    apiKey: string
    baseUrl?: string
    model?: string
    /** 对应 LangGraph checkpointer 里的 thread_id，每个会话一个 */
    sessionId: string
    /** 本轮用户输入 */
    input: string
    /** 用户上传的图片列表 */
    images?: ImageContent[]
    userProfile?: string
    abortSignal?: AbortSignal
}

export interface ResearchToolTrace {
    name: string
    args: Record<string, unknown>
    ok: boolean
    preview: string
}

export interface ResearchAgentOutput {
    content: string
    model: string
    provider: AIProvider
    toolCalls: ResearchToolTrace[]
    aborted?: boolean
}

function createLLM(provider: AIProvider, apiKey: string, baseUrl?: string, model?: string) {
    const defaults = PROVIDER_DEFAULTS[provider]
    let finalBaseUrl = baseUrl || defaults.baseUrl
    finalBaseUrl = finalBaseUrl.replace(/\/chat\/completions\/?$/, '')
    return new ChatOpenAI({
        apiKey,
        model: model || defaults.model,
        temperature: 0.4,
        maxTokens: 16384,
        configuration: {
            baseURL: finalBaseUrl,
        },
    })
}

function compactJson(value: unknown): string {
    return JSON.stringify(value, null, 2)
}

function preview(text: string, maxLength: number = 180): string {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function contentToText(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') return item
                if (item && typeof item === 'object') {
                    const obj = item as { type?: string; text?: unknown }
                    // 只提取文本类型的内容，忽略图片
                    if (obj.type === 'text' && 'text' in obj) {
                        return String(obj.text ?? '')
                    }
                    if (!obj.type && 'text' in obj) {
                        return String(obj.text ?? '')
                    }
                }
                return ''
            })
            .filter(Boolean)
            .join('\n')
    }
    return String(content ?? '')
}

function normalizeToolArgs(args: unknown): Record<string, unknown> {
    return args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
}

const searchStockTool = tool(async ({ keyword }) => compactJson(await searchStock(keyword)), {
    name: 'search_stock',
    description:
        '按股票名称、ETF名称或6位代码搜索A股/ETF，返回候选代码和名称。用户没有给明确代码时先调用这个工具。',
    schema: z.object({
        keyword: z
            .string()
            .describe('股票名称、ETF名称、拼音或6位代码，例如：中国平安、沪深300ETF、601318'),
    }),
})

const getQuoteTool = tool(async ({ code }) => compactJson(await fetchQuote(code)), {
    name: 'get_quote',
    description:
        '查询单只A股或ETF的实时行情，包括现价、涨跌幅、开高低、成交量和时间戳。分析具体标的时通常必须调用。',
    schema: z.object({
        code: z
            .string()
            .regex(/^\d{6}$/)
            .describe('6位股票或ETF代码，例如：601318、510300'),
    }),
})

const getKLineTool = tool(
    async ({ code, days }) => {
        const safeDays = Math.min(Math.max(days ?? 60, 20), 120)
        const rows = await fetchKLine(code, safeDays)
        return compactJson({ code, days: safeDays, klines: rows })
    },
    {
        name: 'get_kline',
        description: '查询日K线，用于判断趋势、支撑压力、阶段涨跌和均线状态。默认60日，最多120日。',
        schema: z.object({
            code: z
                .string()
                .regex(/^\d{6}$/)
                .describe('6位股票或ETF代码'),
            days: z.number().int().min(20).max(120).optional().describe('日K条数，默认60'),
        }),
    }
)

const getSectorInfoTool = tool(async ({ code }) => compactJson(await fetchSectorInfo(code)), {
    name: 'get_sector_info',
    description:
        '查询个股所属行业和细分板块，用于分析它是否贴合当前市场主线。ETF不一定有有效板块信息。',
    schema: z.object({
        code: z
            .string()
            .regex(/^\d{6}$/)
            .describe('6位股票或ETF代码'),
    }),
})

const getDividendsTool = tool(async ({ code }) => compactJson(await fetchDividends(code)), {
    name: 'get_dividends',
    description: '查询近几年分红记录。用户问红利、股息、长期持有、分红日期时调用。',
    schema: z.object({
        code: z
            .string()
            .regex(/^\d{6}$/)
            .describe('6位股票代码'),
    }),
})

const getFundamentalsTool = tool(async ({ code }) => compactJson(await fetchFundamentals(code)), {
    name: 'get_fundamentals',
    description:
        '查询个股基本面与财务数据：估值(PE/PB)、盈利能力(ROE/毛利率/净利率)、成长性(营收/净利同比)、规模(营收/净利)、每股指标(EPS/BPS/经营现金流)、资产负债率、近几期趋势。分析个股估值贵不贵、财务质量、成长性、是否值得长期持有时调用。ETF和非A股可能无数据。',
    schema: z.object({
        code: z
            .string()
            .regex(/^\d{6}$/)
            .describe('6位股票代码，例如：600519、000858'),
    }),
})

interface MyHoldingsItem {
    code: string
    name: string
    sector: string
    quantity: number
    avgCostPrice: number
    currentPrice: number | null
    changePercent: number | null
    marketValue: number | null
    cost: number
    profit: number | null
    profitPercent: number | null
    positionPercent: number | null
    lastTrade: {
        type: 'buy' | 'sell'
        price: number
        quantity: number
        date: string
    } | null
}

interface MyHoldingsPayload {
    count: number
    items: MyHoldingsItem[]
    summary: {
        totalCost: number
        totalMarketValue: number | null
        totalProfit: number | null
        totalProfitPercent: number | null
        sectorDistribution: Array<{
            sector: string
            count: number
            marketValue: number
            percent: number
        }>
        topPositions: Array<{ code: string; name: string; percent: number }>
        fetchFailedCodes: string[]
    }
}

/**
 * 构建用户持仓的实时分析 payload：拉取所有持仓的实时行情，算浮盈亏/市值占比/行业分布。
 * 数量/成本只进 LLM 上下文，不会上传到行情源（行情接口只接收 code）。
 */
async function buildMyHoldingsPayload(): Promise<MyHoldingsPayload> {
    const emptySummary: MyHoldingsPayload['summary'] = {
        totalCost: 0,
        totalMarketValue: null,
        totalProfit: null,
        totalProfitPercent: null,
        sectorDistribution: [],
        topPositions: [],
        fetchFailedCodes: [],
    }
    const holdings = getAllHoldings()
    if (holdings.length === 0) {
        return { count: 0, items: [], summary: emptySummary }
    }

    const codes = holdings.map((h) => h.code)
    const quotes = await fetchBatchQuotes(codes)
    const quoteMap = new Map(quotes.map((q) => [q.code, q]))
    const fetchFailedCodes = codes.filter((c) => !quoteMap.has(c))

    const totalCost = holdings.reduce(
        (s, h) =>
            s + (h.avg_cost_price || (h as { cost_price?: number }).cost_price || 0) * h.quantity,
        0
    )
    const totalMarketValue = holdings.reduce((s, h) => {
        const q = quoteMap.get(h.code)
        return q ? s + q.price * h.quantity : s
    }, 0)

    const items: MyHoldingsItem[] = holdings.map((h) => {
        const costPrice = (h.avg_cost_price || (h as { cost_price?: number }).cost_price || 0) as number
        const cost = costPrice * h.quantity
        const q = quoteMap.get(h.code)
        const marketValue = q ? q.price * h.quantity : null
        const profit = marketValue !== null ? marketValue - cost : null
        const profitPercent = profit !== null && cost > 0 ? (profit / cost) * 100 : null
        const positionPercent =
            marketValue !== null && totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : null
        const sector = [h.sector, h.sub_sector].filter(Boolean).join('/') || '未分类'
        const lastTradeRow = h.trades?.[0]
        return {
            code: h.code,
            name: h.name,
            sector,
            quantity: h.quantity,
            avgCostPrice: costPrice,
            currentPrice: q ? q.price : null,
            changePercent: q ? q.changePercent : null,
            marketValue,
            cost,
            profit,
            profitPercent,
            positionPercent,
            lastTrade: lastTradeRow
                ? {
                      type: lastTradeRow.trade_type,
                      price: lastTradeRow.cost_price,
                      quantity: lastTradeRow.quantity,
                      date: lastTradeRow.trade_date,
                  }
                : null,
        }
    })

    // 行业分布（按市值，行情失败的按成本兜底）
    const sectorMap = new Map<string, { marketValue: number; count: number }>()
    for (const it of items) {
        const mv = it.marketValue ?? it.cost
        const cur = sectorMap.get(it.sector) ?? { marketValue: 0, count: 0 }
        cur.marketValue += mv
        cur.count += 1
        sectorMap.set(it.sector, cur)
    }
    const sectorDistribution = [...sectorMap.entries()]
        .sort((a, b) => b[1].marketValue - a[1].marketValue)
        .map(([sector, v]) => ({
            sector,
            count: v.count,
            marketValue: Math.round(v.marketValue),
            percent:
                totalMarketValue > 0
                    ? Number(((v.marketValue / totalMarketValue) * 100).toFixed(1))
                    : 0,
        }))

    const topPositions = items
        .filter((it) => it.positionPercent !== null)
        .sort((a, b) => (b.positionPercent ?? 0) - (a.positionPercent ?? 0))
        .slice(0, 3)
        .map((it) => ({
            code: it.code,
            name: it.name,
            percent: Number((it.positionPercent as number).toFixed(1)),
        }))

    const allFailed = fetchFailedCodes.length === codes.length
    const totalProfit = totalMarketValue - totalCost
    return {
        count: items.length,
        items: items.sort((a, b) => (b.marketValue ?? b.cost) - (a.marketValue ?? a.cost)),
        summary: {
            totalCost: Math.round(totalCost),
            totalMarketValue: allFailed ? null : Math.round(totalMarketValue),
            totalProfit: allFailed ? null : Math.round(totalProfit),
            totalProfitPercent:
                allFailed || totalCost <= 0
                    ? null
                    : Number(((totalProfit / totalCost) * 100).toFixed(2)),
            sectorDistribution,
            topPositions,
            fetchFailedCodes,
        },
    }
}

const getMyHoldingsTool = tool(
    async () => compactJson(await buildMyHoldingsPayload()),
    {
        name: 'get_my_holdings',
        description:
            '查询用户当前全部持仓的实时分析数据：每只持仓的实时价、浮盈亏、收益率、市值占比、行业分布、汇总统计。当用户问"我的持仓怎么样""要不要调仓/止盈/止损""哪只该卖""组合是否健康""仓位重不重"等需要基于实际持仓做判断时，必须调用此工具。返回的是用户本地持仓记录，不会上传任何第三方。',
        schema: z.object({}).describe('无需入参，自动读取用户本地全部持仓'),
    }
)

const researchTools = [
    searchStockTool,
    getQuoteTool,
    getKLineTool,
    getSectorInfoTool,
    getDividendsTool,
    getFundamentalsTool,
    getMyHoldingsTool,
]

const SYSTEM_PROMPT = `你是A股研究助手，服务对象是正在学习投资的新手。

长期记忆使用规则：
1. 用户画像只代表用户偏好和约束，不代表市场事实。
2. 画像里的"当前持仓"段落是用户本地记录的事实（代码/数量/成本价/行业），可以引用，但只是成本口径，不含实时价与浮盈亏。
3. 画像里没有"可用现金"信息，不要主动给出"你有7000元"之类的假设。如果需要资金额度才能给建议，直接问用户当前打算用多少资金。
4. 涉及实时价格、走势、分红、板块时，仍必须调用工具获取最新数据；要拿持仓实时盈亏请调用 get_my_holdings。
5. 给建议时结合画像里的风险偏好、偏好品种、回避品种，以及已有持仓（避免让用户重复买入已持有标的、注意行业集中度）。

工具使用规则：
1. 当用户询问具体股票、ETF、实时价格、还能不能买、是否继续上涨、趋势、分红、板块归属时，必须优先调用工具获取最新数据。
2. 如果用户只给名称没有代码，先调用 search_stock 找代码；如果候选很多，选最匹配的一只并说明可能存在同名歧义。
3. 做具体标的判断时，通常至少调用 get_quote；涉及趋势必须调用 get_kline；涉及行业逻辑调用 get_sector_info；涉及红利/长期持有调用 get_dividends。
4. 如果没有调用工具，不要声称知道实时行情、最新涨跌幅、最新K线或分红日期。
5. 工具失败时，明确说明对应数据暂不可用，不要补编。
6. 在调用工具期间，不要输出任何规划说明或中间文字；工具全部执行完毕后再统一给出分析回答。
7. 持仓工具使用：当用户问"我的持仓""要不要调仓/止盈/止损""哪只该卖""组合健康度""仓位重不重"等需要基于自己实际持仓做判断的问题时，必须调用 get_my_holdings 拿到实时盈亏与仓位占比后再回答；不要只用画像里的成本口径快照做实时判断。get_my_holdings 返回的数据已包含实时价、浮盈亏、行业分布，无需再对其中已持有的代码重复调用 get_quote。

回答要求：
- 用 Markdown 格式回答，支持标题、列表、加粗、表格等。
- 回答直接简洁，适合新手理解。
- 明确区分"数据事实"和"基于数据的判断"。
- 不输出买卖指令，只给观察建议、参考条件和风险提示。
- 若给价位，必须说明是参考观察价，不构成投资建议。
- 涉及用户持仓的建议（止盈/止损/调仓/加仓）时，必须基于 get_my_holdings 返回的实时盈亏与仓位占比，明确给出参考条件而非买卖指令，同时提示行业集中度风险。
- 每次具体标的分析最后给一句"新手注意"。`

export async function runResearchAgent(
    params: ResearchAgentInput,
    onChunk?: (chunk: string) => void
): Promise<ResearchAgentOutput> {
    const llm = createLLM(params.provider, params.apiKey, params.baseUrl, params.model)
    const checkpointer = getChatCheckpointer()

    // system prompt 每轮动态注入（用户画像可能变化），不进入 state
    const fullPrompt = params.userProfile
        ? `${SYSTEM_PROMPT}\n\n用户长期投资画像：\n${params.userProfile}`
        : SYSTEM_PROMPT

    const agent = createReactAgent({
        llm,
        tools: researchTools,
        prompt: fullPrompt,
        checkpointer,
    })

    const config = {
        configurable: { thread_id: params.sessionId },
        signal: params.abortSignal,
        version: 'v2' as const,
        // 单轮最多允许的 LangGraph 节点执行次数（防止工具死循环）
        recursionLimit: 25,
    }

    const toolCalls: ResearchToolTrace[] = []
    let finalContent = ''
    let aborted = false
    let lastFinishReason: string | null = null

    // 构建多模态消息内容
    const messageContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
    messageContent.push({ type: 'text', text: params.input })
    
    if (params.images && params.images.length > 0) {
        for (const img of params.images) {
            messageContent.push({
                type: 'image_url',
                image_url: { url: img.dataUrl }
            })
        }
    }

    try {
        const stream = agent.streamEvents(
            { messages: [new HumanMessage({ content: messageContent })] },
            config
        )

        for await (const event of stream) {
            if (event.event === 'on_chat_model_stream') {
                const chunk = (event.data as { chunk?: BaseMessage })?.chunk
                const text = contentToText(chunk?.content)
                if (text) {
                    finalContent += text
                    onChunk?.(text)
                }
                const metadata = (chunk as { response_metadata?: { finish_reason?: string } })?.response_metadata
                if (metadata?.finish_reason) {
                    lastFinishReason = metadata.finish_reason
                }
            } else if (event.event === 'on_chat_model_end') {
                const message = (event.data as { message?: BaseMessage })?.message
                if (message && isAIMessage(message)) {
                    const fullText = contentToText(message.content)
                    if (fullText && fullText.length > finalContent.length) {
                        const missingPart = fullText.slice(finalContent.length)
                        finalContent = fullText
                        if (missingPart) {
                            onChunk?.(missingPart)
                        }
                    }
                }
            } else if (event.event === 'on_tool_end') {
                const output = (event.data as { output?: unknown; input?: unknown })?.output
                const isToolMsg = output instanceof ToolMessage
                const content = isToolMsg ? contentToText(output.content) : contentToText(output)
                const ok = !isToolMsg || output.status !== 'error'
                toolCalls.push({
                    name: event.name ?? 'unknown',
                    args: normalizeToolArgs((event.data as { input?: unknown })?.input),
                    ok,
                    preview: preview(content),
                })
            }
        }
    } catch (e) {
        const isAbort =
            params.abortSignal?.aborted ||
            (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))
        if (!isAbort) throw e
        aborted = true
    }

    return {
        content: finalContent,
        model: params.model || PROVIDER_DEFAULTS[params.provider].model,
        provider: params.provider,
        toolCalls,
        aborted,
    }
}

/**
 * 从 checkpointer 读回某个会话已有的可见消息（供 UI 恢复）。
 * 注意：这只拿 HumanMessage / AIMessage 里可显示的部分，中间的 ToolMessage 不返回。
 */
export async function getSessionMessagesFromCheckpoint(
    sessionId: string
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const checkpointer = getChatCheckpointer()
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: sessionId } })
    if (!tuple) return []
    const raw = (tuple.checkpoint.channel_values as { messages?: BaseMessage[] })?.messages ?? []
    const result: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const msg of raw) {
        const text = contentToText(msg.content).trim()
        if (!text) continue
        if (isHumanMessage(msg)) {
            result.push({ role: 'user', content: text })
        } else if (isAIMessage(msg) && !isToolMessage(msg)) {
            // 忽略只有 tool_calls 没有内容的中间 AIMessage
            result.push({ role: 'assistant', content: text })
        }
    }
    return result
}
