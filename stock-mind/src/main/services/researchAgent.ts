/**
 * 股票研究 Agent - 基于 LangChain tool calling 实现
 *
 * 学习要点：
 * 1. tool schema        — 明确告诉模型每个工具能做什么、需要什么参数
 * 2. bindTools          — 把工具绑定到 LLM，让模型可以选择调用
 * 3. tool loop          — 模型提出工具调用 -> 程序执行工具 -> 结果返回模型 -> 模型继续推理
 * 4. grounding          — 回答必须基于工具返回的数据，减少凭空编造实时行情
 * 5. max iterations     — 限制循环次数，避免 Agent 无限调用工具
 */

import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { ToolCall } from '@langchain/core/messages/tool'
import type { AIProvider } from './ai'
import { fetchQuote, fetchKLine, fetchSectorInfo, fetchDividends, searchStock } from './market'

const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    ernie: { baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k-preview' },
}

export interface ResearchAgentInput {
    provider: AIProvider
    apiKey: string
    baseUrl?: string
    model?: string
    input: string
    history: Array<{ role: string; content: string }>
    userProfile?: string
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

function toLCMessages(raw: Array<{ role: string; content: string }>): BaseMessage[] {
    return raw
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)))
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

type InvokableTool = {
    invoke(input: Record<string, unknown>): Promise<unknown>
}

const toolMap = new Map<string, InvokableTool>(
    researchTools.map((item) => [item.name, item as unknown as InvokableTool])
)

const SYSTEM_PROMPT = `你是A股研究助手，服务对象是正在学习投资的新手。

长期记忆使用规则：
1. 用户画像只代表用户偏好和约束，不代表市场事实。
2. 画像里没有资金信息，不要主动给出“你有7000元”之类的假设。如果需要资金信息才能给建议，直接问用户当前打算用多少资金。
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
- 明确区分“数据事实”和“基于数据的判断”。
- 不输出买卖指令，只给观察建议、参考条件和风险提示。
- 若给价位，必须说明是参考观察价，不构成投资建议。
- 每次具体标的分析最后给一句“新手注意”。`

export async function runResearchAgent(
    params: ResearchAgentInput,
    onChunk?: (chunk: string) => void
): Promise<ResearchAgentOutput> {
    const llm = createLLM(params.provider, params.apiKey, params.baseUrl, params.model)
    const llmWithTools = llm.bindTools(researchTools)
    const messages: BaseMessage[] = [
        new SystemMessage(SYSTEM_PROMPT),
        ...(params.userProfile
            ? [new SystemMessage(`用户长期投资画像：\n${params.userProfile}`)]
            : []),
        ...toLCMessages(params.history),
        new HumanMessage(params.input),
    ]
    const toolCalls: ResearchToolTrace[] = []

    for (let step = 0; step < 4; step++) {
        const aiMessage = await llmWithTools.invoke(messages)
        messages.push(aiMessage)

        const calls = (aiMessage.tool_calls ?? []) as ToolCall[]
        if (calls.length === 0) {
            // 最终回答阶段：流式推送
            const content = await streamFinalAnswer(llm, messages, onChunk)
            return {
                content,
                model: params.model || PROVIDER_DEFAULTS[params.provider].model,
                provider: params.provider,
                toolCalls,
            }
        }

        for (const call of calls) {
            const selectedTool = toolMap.get(call.name)
            const callId = call.id || `${call.name}-${step}-${toolCalls.length}`
            const args = normalizeToolArgs(call.args)

            if (!selectedTool) {
                const content = compactJson({ error: `未知工具：${call.name}` })
                toolCalls.push({ name: call.name, args, ok: false, preview: preview(content) })
                messages.push(new ToolMessage({ tool_call_id: callId, content, status: 'error' }))
                continue
            }

            try {
                const result = await selectedTool.invoke(args)
                const content = contentToText(result)
                toolCalls.push({ name: call.name, args, ok: true, preview: preview(content) })
                messages.push(new ToolMessage({ tool_call_id: callId, content, status: 'success' }))
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                const content = compactJson({ error: message })
                toolCalls.push({ name: call.name, args, ok: false, preview: preview(content) })
                messages.push(new ToolMessage({ tool_call_id: callId, content, status: 'error' }))
            }
        }
    }

    // 超出最大工具调用轮次，流式输出最终回答
    const content = await streamFinalAnswer(
        llm,
        [
            ...messages,
            new HumanMessage(
                '请基于已经拿到的工具结果给出最终回答；如果信息不足，明确说明缺哪些数据。'
            ),
        ],
        onChunk
    )

    return {
        content,
        model: params.model || PROVIDER_DEFAULTS[params.provider].model,
        provider: params.provider,
        toolCalls,
    }
}

async function streamFinalAnswer(
    llm: ReturnType<typeof createLLM>,
    messages: BaseMessage[],
    onChunk?: (chunk: string) => void
): Promise<string> {
    if (!onChunk) {
        const msg = await llm.invoke(messages)
        return contentToText(msg.content)
    }

    let fullContent = ''
    const stream = await llm.stream(messages)
    for await (const chunk of stream) {
        const text = contentToText(chunk.content)
        if (text) {
            fullContent += text
            onChunk(text)
        }
    }
    return fullContent
}
