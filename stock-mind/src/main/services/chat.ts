/**
 * AI 对话 - 基于 LangChain LCEL 实现
 *
 * 学习要点（第一步）：
 * 1. ChatPromptTemplate     — 结构化 prompt，支持 {变量} 插值
 * 2. ChatOpenAI             — LangChain 的 LLM 包装器，统一接口
 * 3. StringOutputParser     — 把 AIMessage 对象解析成纯字符串
 * 4. RunnableSequence / pipe — 用 | 把多个组件串成一条 chain
 * 5. MessagesPlaceholder    — 在 prompt 里占位，运行时插入历史消息列表
 *
 * Chain 结构：
 *   ChatPromptTemplate
 *     └─ [SystemMessage + MessagesPlaceholder(history) + HumanMessage(input)]
 *         │
 *         ▼ .pipe()
 *   ChatOpenAI  (LLM 调用)
 *         │
 *         ▼ .pipe()
 *   StringOutputParser  (AIMessage → string)
 */

import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import type { AIProvider } from './ai'

// ─── Provider 默认配置（与 ai.ts / agent.ts 保持一致）────────────────────────
const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    ernie: { baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k-preview' },
}

// ─── 1. 创建 LLM 实例 ─────────────────────────────────────────────────────────
function createLLM(provider: AIProvider, apiKey: string, baseUrl?: string, model?: string) {
    const defaults = PROVIDER_DEFAULTS[provider]
    return new ChatOpenAI({
        apiKey,
        model: model || defaults.model,
        temperature: 0.7,
        maxTokens: 2000,
        configuration: {
            baseURL: baseUrl || defaults.baseUrl,
        },
    })
}

// ─── 2. Prompt 模板 ───────────────────────────────────────────────────────────
// MessagesPlaceholder("history") 是关键：
//   运行时把历史对话列表插入到 system 和 human 之间
//   这样 AI 就有"记忆"，知道前几轮说了什么
const chatPrompt = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是一个A股投资入门助手，服务对象是零基础新手投资者。

你的职责：
1. 可以直接给出具体的A股代码和参考价位，但必须同时解释清楚"为什么"，让新手看懂。
2. 优先推荐风险相对较低的品种：沪深主板蓝筹股（60xxxx / 00xxxx）、宽基ETF（如510300沪深300ETF、510500中证500ETF）。
3. 给出买入参考价、止损价、目标价，并用大白话解释每个价位的含义。
4. 遇到专业名词（如MACD、均线、量比等），主动用一两句话解释清楚。
5. 主动提示风险：仓位不能押太重、不要追涨杀跌、止损要执行。

【标的选择偏好】
- 优先：沪市主板60xxxx、深市主板00xxxx、宽基ETF（510开头）
- 避免推荐：创业板300、科创板688、北交所，这些波动大、不适合新手
- 个股优先选：行业龙头、业绩稳定、市值大、流动性好的

【回答风格】
- 直接给代码，不绕弯子
- 用中文口语，不堆砌金融术语
- 每次推荐加一句"新手注意"提示操作要点
- 免责声明只在第一轮带一次：以上为研究参考，不构成投资建议，亏损风险自担。`,
    ],
    // ★ 核心：在 system 和 human 之间插入历史消息
    new MessagesPlaceholder('history'),
    ['human', '{input}'],
])

// ─── 3. 构建 Chain（LCEL 管道）───────────────────────────────────────────────
// 写法等价于：chatPrompt.pipe(llm).pipe(new StringOutputParser())
// 每个 .pipe() 把上一步的输出作为下一步的输入
export function buildChatChain(
    provider: AIProvider,
    apiKey: string,
    baseUrl?: string,
    model?: string
) {
    const llm = createLLM(provider, apiKey, baseUrl, model)

    return chatPrompt
        .pipe(llm) // prompt → ChatOpenAI → AIMessage
        .pipe(new StringOutputParser()) // AIMessage → string
}

// ─── 4. 消息格式转换 ──────────────────────────────────────────────────────────
// 前端传来的是 { role: 'user'|'assistant', content: string }[]
// LangChain 需要 HumanMessage / AIMessage 对象
export function toLCMessages(
    raw: Array<{ role: string; content: string }>
): Array<HumanMessage | AIMessage> {
    return raw
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)))
}

// ─── 5. 对外调用入口 ──────────────────────────────────────────────────────────
export interface ChatInput {
    provider: AIProvider
    apiKey: string
    baseUrl?: string
    model?: string
    // 当前这轮用户输入
    input: string
    // 不含本轮的历史记录（role: user/assistant）
    history: Array<{ role: string; content: string }>
}

export async function runChat(params: ChatInput): Promise<string> {
    const chain = buildChatChain(params.provider, params.apiKey, params.baseUrl, params.model)

    // ★ 把历史消息转成 LangChain Message 对象，注入 MessagesPlaceholder
    const history = toLCMessages(params.history)

    const result = await chain.invoke({
        history,
        input: params.input,
    })

    return result
}
