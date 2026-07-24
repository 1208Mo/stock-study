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
import { fetchQuote, fetchKLine, fetchSectorInfo, fetchDividends, searchStock } from './market'
import { getChatCheckpointer } from './chatCheckpointer'

const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    ernie: { baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k-preview' },
    volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
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
    return new ChatOpenAI({
        apiKey,
        model: model || defaults.model,
        temperature: 0.4,
        maxTokens: 2200,
        configuration: {
            baseURL: baseUrl || defaults.baseUrl,
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
                if (item && typeof item === 'object' && 'text' in item) {
                    return String((item as { text?: unknown }).text ?? '')
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

const researchTools = [
    searchStockTool,
    getQuoteTool,
    getKLineTool,
    getSectorInfoTool,
    getDividendsTool,
]

const SYSTEM_PROMPT = `你是A股研究助手，服务对象是正在学习投资的新手。

长期记忆使用规则：
1. 用户画像只代表用户偏好和约束，不代表市场事实。
2. 画像里没有资金信息，不要主动给出"你有7000元"之类的假设。如果需要资金信息才能给建议，直接问用户当前打算用多少资金。
3. 涉及实时价格、走势、分红、板块时，仍必须调用工具获取最新数据。
4. 给建议时结合画像里的风险偏好、偏好品种和回避品种。

工具使用规则：
1. 当用户询问具体股票、ETF、实时价格、还能不能买、是否继续上涨、趋势、分红、板块归属时，必须优先调用工具获取最新数据。
2. 如果用户只给名称没有代码，先调用 search_stock 找代码；如果候选很多，选最匹配的一只并说明可能存在同名歧义。
3. 做具体标的判断时，通常至少调用 get_quote；涉及趋势必须调用 get_kline；涉及行业逻辑调用 get_sector_info；涉及红利/长期持有调用 get_dividends。
4. 如果没有调用工具，不要声称知道实时行情、最新涨跌幅、最新K线或分红日期。
5. 工具失败时，明确说明对应数据暂不可用，不要补编。
6. 在调用工具期间，不要输出任何规划说明或中间文字；工具全部执行完毕后再统一给出分析回答。

回答要求：
- 用 Markdown 格式回答，支持标题、列表、加粗、表格等。
- 回答直接简洁，适合新手理解。
- 明确区分"数据事实"和"基于数据的判断"。
- 不输出买卖指令，只给观察建议、参考条件和风险提示。
- 若给价位，必须说明是参考观察价，不构成投资建议。
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

    // 用 streamEvents 同时拿 token 流 + 工具调用轨迹
    // 只喂本轮 user 消息，checkpointer 会自动把历史 messages 加载进 state
    try {
        const stream = agent.streamEvents(
            { messages: [new HumanMessage(params.input)] },
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
