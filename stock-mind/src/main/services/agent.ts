/**
 * LangGraph Agent - 每日决策流程
 *
 * 学习要点：
 * 1. ChatPromptTemplate  — 结构化 prompt，变量用 {占位符}
 * 2. RunnableSequence    — 把多个步骤串成一条 chain：prompt | llm | parser
 * 3. StateGraph          — 把整个决策流程建模成有向图，每个节点是一个异步函数
 * 4. Annotation          — 定义图的状态 schema（相当于流程的「全局变量」）
 * 5. 条件边              — 根据状态值决定下一步走哪个节点
 */

import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
import { ChatOpenAI } from '@langchain/openai'
import { StateGraph, Annotation, END } from '@langchain/langgraph'
import { z } from 'zod'
import {
    fetchMarketNews,
    fetchTopSectors,
    fetchBatchQuotes,
    fetchDynamicCandidates,
} from './market'
import type { QuoteData } from './market'
import type { AIProvider } from './ai'

// 与 ai.ts 保持一致
const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    ernie: { baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k-preview' },
}

// ─── 1. 结构化输出定义 ───────────────────────────────────────────────────────
// 学习点：LLM 输出是不可信输入，先用 zod 做运行时校验，再交给程序使用。
const StructuredDecisionPickSchema = z.object({
    priority: z.coerce.number().int().min(1).max(3),
    action: z.enum(['watch', 'avoid']),
    code: z.string(),
    name: z.string(),
    reason: z.string(),
    aggressiveEntry: z.coerce.number().nullable(),
    conservativeEntry: z.coerce.number().nullable(),
    stopLoss: z.coerce.number().nullable(),
    takeProfit: z.coerce.number().nullable(),
    positionAmount: z.coerce.number().int().nonnegative(),
    noBuyCondition: z.string(),
    riskNote: z.string(),
})

const StructuredDecisionSchema = z.object({
    summary: z.string(),
    marketBias: z.enum(['positive', 'neutral', 'negative']),
    maxPositionPerTarget: z.coerce.number().int().nonnegative(),
    observeReason: z.string().nullable(),
    picks: z.array(StructuredDecisionPickSchema).max(3),
})

export type StructuredDecision = z.infer<typeof StructuredDecisionSchema>

export interface AgentDiagnostics {
    discoveredCandidates: Array<{ code: string; name: string }>
    filterNotes: string[]
    riskWarnings: string[]
    validationIssues: string[]
    workflowNotes: string[]
    quoteCount: number
    filteredQuoteCount: number
}

// ─── 2. 图的状态定义 ─────────────────────────────────────────────────────────
// Annotation.Root 定义整张图共享的状态结构
// reducer 决定多次写入同一字段时如何合并（这里用最新值覆盖）
const DecisionState = Annotation.Root({
    date: Annotation<string>({ reducer: (_: string, b: string) => b }),
    capital: Annotation<number>({ reducer: (_: number, b: number) => b, default: () => 5000 }),
    riskLevel: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '平衡' }),
    userProfile: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
    headlines: Annotation<string[]>({
        reducer: (_: string[], b: string[]) => b,
        default: () => [],
    }),
    topSectors: Annotation<Array<{ name: string; changePercent: number }>>({
        reducer: (
            _: Array<{ name: string; changePercent: number }>,
            b: Array<{ name: string; changePercent: number }>
        ) => b,
        default: () => [],
    }),
    marketContext: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
    candidateCodes: Annotation<Array<{ code: string; name: string }>>({
        reducer: (
            _: Array<{ code: string; name: string }>,
            b: Array<{ code: string; name: string }>
        ) => b,
        default: () => [],
    }),
    discoveredCandidates: Annotation<Array<{ code: string; name: string }>>({
        reducer: (
            _: Array<{ code: string; name: string }>,
            b: Array<{ code: string; name: string }>
        ) => b,
        default: () => [],
    }),
    quotes: Annotation<QuoteData[]>({
        reducer: (_: QuoteData[], b: QuoteData[]) => b,
        default: () => [],
    }),
    filteredQuotes: Annotation<QuoteData[]>({
        reducer: (_: QuoteData[], b: QuoteData[]) => b,
        default: () => [],
    }),
    filterNotes: Annotation<string[]>({
        reducer: (_: string[], b: string[]) => b,
        default: () => [],
    }),
    riskWarnings: Annotation<string[]>({
        reducer: (_: string[], b: string[]) => b,
        default: () => [],
    }),
    validationIssues: Annotation<string[]>({
        reducer: (_: string[], b: string[]) => b,
        default: () => [],
    }),
    workflowNotes: Annotation<string[]>({
        reducer: (a: string[], b: string[]) => [...a, ...b],
        default: () => [],
    }),
    decision: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
    structuredDecision: Annotation<StructuredDecision | null>({
        reducer: (_: StructuredDecision | null, b: StructuredDecision | null) => b,
        default: () => null,
    }),
    error: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
})

type DecisionStateType = typeof DecisionState.State

// ─── 2. LLM 实例 ─────────────────────────────────────────────────────────────
// 优先读用户在设置里配置的 provider / key / baseUrl / model
// 所有 provider（DeepSeek/OpenAI/通义）都用 OpenAI 兼容接口
// 文心同样支持 OpenAI 兼容端点（qianfan.baidubce.com/v2），无需单独 SDK
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

// ─── 3. Prompt 模板 ───────────────────────────────────────────────────────────
// ChatPromptTemplate.fromMessages 比手拼字符串更结构化，支持变量插值
const marketContextTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是A股市场分析师，根据今日财经快讯和板块涨幅，快速提炼市场主线。
输出格式简洁，直接给结论，不废话。`,
    ],
    [
        'human',
        `日期：{date}

今日财经快讯（前25条）：
{headlines}

今日领涨板块：
{sectors}

请输出：

**📈 今日主线方向**
（按强弱排序，每个方向说明原因一句话）

**📉 今日回避方向**
（哪些板块今日偏弱或有利空）

**🎯 今日推荐关注标的**
按主线方向，每个方向给2-3个代码+名称，格式：
- 方向名：代码1 名称1，代码2 名称2（理由）

**⚠️ 今日决策提示**
（一句话总结：今天适合做什么，回避什么）`,
    ],
])

const decisionTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是A股盘前决策助手。你的任务不是写 Markdown，而是输出可被程序解析的 JSON。
规则：
1. 只输出合法 JSON，不要使用 Markdown，不要包裹 \`\`\`json。
2. 根据每只股票自身数据给出差异化判断，不同候选 reason 必须不同。
3. 若所有候选处境类似或风险偏高，picks 输出空数组，并在 observeReason 写明观望原因。
4. 单标的 positionAmount 不超过 maxPositionPerTarget。
5. action 只能是 "watch" 或 "avoid"，不允许输出直接买入指令。
6. 所有价格字段必须使用候选池里已经给出的价位，不要自行编造。
7. 用户画像只代表长期偏好和约束，不代表市场事实。`,
    ],
    [
        'human',
        `可用资金：{capital} 元
风险偏好：{riskLevel}
用户长期投资画像：
{userProfile}

今日市场背景：{marketContext}
单标的最大仓位：{maxPosition} 元

风控提示：
{riskWarnings}

有效候选池：
{candidates}

请严格按下面 JSON 结构输出：
{{
  "summary": "一句话总结今天策略",
  "marketBias": "positive | neutral | negative",
  "maxPositionPerTarget": {maxPosition},
  "observeReason": "如果整体观望，写原因；否则为 null",
  "picks": [
    {{
      "priority": 1,
      "action": "watch | avoid",
      "code": "股票代码",
      "name": "股票名称",
      "reason": "基于这只标的自身数据的理由",
      "aggressiveEntry": 0,
      "conservativeEntry": 0,
      "stopLoss": 0,
      "takeProfit": 0,
      "positionAmount": 0,
      "noBuyCondition": "针对这只的具体不买条件",
      "riskNote": "针对这只的主要风险"
    }}
  ]
}}`,
    ],
])

function extractJson(text: string): unknown {
    const trimmed = text.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    const jsonText = fenced ? fenced[1] : trimmed
    return JSON.parse(jsonText)
}

function formatNullablePrice(value: number | null): string {
    if (value === null) return '无'
    return value >= 10 ? value.toFixed(2) : value.toFixed(3)
}

function renderStructuredDecision(decision: StructuredDecision): string {
    const biasText =
        decision.marketBias === 'positive'
            ? '偏积极'
            : decision.marketBias === 'negative'
              ? '偏谨慎'
              : '中性'

    const header = `**结论快照**\n${decision.summary}\n\n市场状态：${biasText}\n单标的最大仓位：${decision.maxPositionPerTarget} 元`

    if (decision.picks.length === 0) {
        return `${header}\n\n❌ 今天建议观望，原因：${decision.observeReason || '候选池没有明显优势标的'}`
    }

    const picks = decision.picks
        .sort((a, b) => a.priority - b.priority)
        .map(
            (item) =>
                `---\n📌 优先级${item.priority}：${item.code} ${item.name}\n操作类型：${item.action === 'watch' ? '观察等待' : '暂时回避'}\n理由：${item.reason}\n💰 买入价\n- 激进挂：${formatNullablePrice(item.aggressiveEntry)}\n- 保守挂：${formatNullablePrice(item.conservativeEntry)}\n🛑 止损线：${formatNullablePrice(item.stopLoss)}\n🎯 止盈：${formatNullablePrice(item.takeProfit)}\n📦 仓位：${item.positionAmount} 元\n⚠️ 不买：${item.noBuyCondition}\n风险：${item.riskNote}`
        )
        .join('\n')

    return `${header}\n\n${picks}`
}

// ─── 4. 图节点定义 ────────────────────────────────────────────────────────────
// 每个节点是一个 async 函数，接收当前状态，返回需要更新的字段

async function nodesFetchNews(state: DecisionStateType): Promise<Partial<DecisionStateType>> {
    // 并发拉取快讯和板块数据
    const [headlines, topSectors] = await Promise.allSettled([
        fetchMarketNews(25),
        fetchTopSectors(12),
    ])
    return {
        headlines: headlines.status === 'fulfilled' ? headlines.value : [],
        topSectors: topSectors.status === 'fulfilled' ? topSectors.value : [],
    }
}

// analyzeMarket 是一个 RunnableSequence（chain）
// 学习点：prompt | llm | parser 的管道写法
function buildAnalyzeMarketNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([
        marketContextTemplate,
        llm,
        new StringOutputParser(), // 把 AIMessage 解析成纯字符串
    ])

    return async function nodeAnalyzeMarket(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        if (state.headlines.length === 0 && state.topSectors.length === 0) {
            return { marketContext: '今日暂无市场数据' }
        }
        const headlinesText = state.headlines
            .slice(0, 25)
            .map((h: string, i: number) => `${i + 1}. ${h}`)
            .join('\n')
        const sectorsText =
            state.topSectors.length > 0
                ? state.topSectors
                      .map(
                          (s: { name: string; changePercent: number }, i: number) =>
                              `${i + 1}. ${s.name} ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`
                      )
                      .join('\n')
                : '暂无板块数据'

        const result = await chain.invoke({
            date: state.date,
            headlines: headlinesText,
            sectors: sectorsText,
        })
        return { marketContext: result }
    }
}

async function nodeDiscoverCandidates(
    state: DecisionStateType
): Promise<Partial<DecisionStateType>> {
    if (state.candidateCodes.length > 0) {
        return {
            discoveredCandidates: state.candidateCodes,
            workflowNotes: [`使用用户提供的 ${state.candidateCodes.length} 个候选标的。`],
        }
    }

    try {
        const discoveredCandidates = await fetchDynamicCandidates(5, 4)
        return {
            candidateCodes: discoveredCandidates,
            discoveredCandidates,
            workflowNotes: [
                `候选池为空，Agent 从今日领涨板块自动发现 ${discoveredCandidates.length} 个候选标的。`,
            ],
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
            discoveredCandidates: [],
            workflowNotes: [`自动发现候选池失败：${message}`],
        }
    }
}

async function nodesFetchQuotes(state: DecisionStateType): Promise<Partial<DecisionStateType>> {
    if (state.candidateCodes.length === 0) {
        return { workflowNotes: ['没有候选代码，跳过行情拉取。'] }
    }
    const codes = state.candidateCodes.map((c: { code: string; name: string }) => c.code)
    const quotes = await fetchBatchQuotes(codes)
    return {
        quotes,
        workflowNotes: [`行情拉取完成：请求 ${codes.length} 个，成功 ${quotes.length} 个。`],
    }
}

function isEtf(name: string, code: string) {
    return name.includes('ETF') || code.startsWith('5') || code.startsWith('1')
}

function calcReferencePrices(q: QuoteData) {
    const etf = isEtf(q.name, q.code)
    return {
        aggressive: Number((q.price * (etf ? 0.995 : 0.99)).toFixed(3)),
        conservative: Number((q.price * (etf ? 0.985 : 0.975)).toFixed(3)),
        stopLoss: Number((q.price * (etf ? 0.97 : 0.965)).toFixed(3)),
        takeProfit: Number((q.price * (etf ? 1.025 : 1.04)).toFixed(3)),
    }
}

async function nodeTechnicalFilter(state: DecisionStateType): Promise<Partial<DecisionStateType>> {
    const kept: QuoteData[] = []
    const notes: string[] = []

    for (const q of state.quotes) {
        const etf = isEtf(q.name, q.code)
        const highChange = etf ? 2.5 : 4
        const severeDrop = etf ? -4 : -7

        if (!Number.isFinite(q.price) || q.price <= 0) {
            notes.push(`${q.code} ${q.name}：价格无效，过滤。`)
            continue
        }
        if (q.changePercent >= highChange) {
            notes.push(
                `${q.code} ${q.name}：今日已涨 ${q.changePercent.toFixed(2)}%，过滤追高风险。`
            )
            continue
        }
        if (q.changePercent <= severeDrop) {
            notes.push(
                `${q.code} ${q.name}：今日跌幅 ${q.changePercent.toFixed(2)}%，过滤下跌未稳风险。`
            )
            continue
        }
        if (q.high > 0 && q.price >= q.high * 0.992) {
            notes.push(`${q.code} ${q.name}：接近日内高点，过滤冲高回落风险。`)
            continue
        }

        kept.push(q)
    }

    return {
        filteredQuotes: kept,
        filterNotes: notes,
        workflowNotes: [
            `技术过滤完成：保留 ${kept.length} 个，过滤 ${state.quotes.length - kept.length} 个。`,
        ],
    }
}

async function nodeRiskCheck(state: DecisionStateType): Promise<Partial<DecisionStateType>> {
    const kept: QuoteData[] = []
    const warnings: string[] = []
    const riskLevel = state.riskLevel ?? '平衡'

    for (const q of state.filteredQuotes) {
        const isHighVolatilityBoard =
            q.code.startsWith('300') ||
            q.code.startsWith('688') ||
            q.code.startsWith('8') ||
            q.code.startsWith('4')
        const isSt = q.name.toUpperCase().includes('ST')

        if (isSt) {
            warnings.push(`${q.code} ${q.name}：ST 标的，直接过滤。`)
            continue
        }
        if (isHighVolatilityBoard && riskLevel !== '激进') {
            warnings.push(
                `${q.code} ${q.name}：创业板/科创板/北交所波动更高，当前风险偏好为“${riskLevel}”，过滤。`
            )
            continue
        }
        if (!isEtf(q.name, q.code) && q.changePercent > 3 && riskLevel === '稳一点') {
            warnings.push(`${q.code} ${q.name}：稳健模式下不追 3% 以上个股，过滤。`)
            continue
        }

        kept.push(q)
    }

    return {
        filteredQuotes: kept,
        riskWarnings: warnings.length > 0 ? warnings : ['未发现需要硬过滤的风控问题。'],
        workflowNotes: [
            `风控检查完成：保留 ${kept.length} 个，过滤 ${state.filteredQuotes.length - kept.length} 个。`,
        ],
    }
}

function buildMakeDecisionNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([decisionTemplate, llm, new StringOutputParser()])

    return async function nodeMakeDecision(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        const capital = state.capital ?? 5000
        const maxPosition = Math.round(capital * 0.2)

        if (state.filteredQuotes.length === 0) {
            const structuredDecision: StructuredDecision = {
                summary:
                    state.quotes.length === 0
                        ? '候选池行情获取失败，无法生成决策。'
                        : '候选池经过技术过滤和风控检查后，没有适合今天观察的标的。',
                marketBias: 'neutral',
                maxPositionPerTarget: maxPosition,
                observeReason:
                    state.quotes.length === 0
                        ? '没有可用行情数据'
                        : '所有候选都触发了技术过滤或风控规则',
                picks: [],
            }
            return { decision: renderStructuredDecision(structuredDecision), structuredDecision }
        }

        const candidateLines = state.filteredQuotes
            .map((q: QuoteData) => {
                const prices = calcReferencePrices(q)
                return `${q.code} ${q.name}
  现价 ${q.price}，今日 ${q.changePercent >= 0 ? '+' : ''}${q.changePercent}%
  日内：开 ${q.open}，高 ${q.high}，低 ${q.low}
  可用价位：aggressiveEntry=${prices.aggressive}, conservativeEntry=${prices.conservative}, stopLoss=${prices.stopLoss}, takeProfit=${prices.takeProfit}`
            })
            .join('\n\n')

        const riskLevel = state.riskLevel ?? '平衡'
        const result = await chain.invoke({
            capital,
            riskLevel,
            userProfile: state.userProfile || '未设置长期投资画像',
            marketContext: state.marketContext || '无市场背景',
            riskWarnings:
                state.riskWarnings.length > 0
                    ? state.riskWarnings.map((item, i) => `${i + 1}. ${item}`).join('\n')
                    : '无',
            candidates: candidateLines,
            maxPosition,
        })

        try {
            const structuredDecision = StructuredDecisionSchema.parse(extractJson(result))
            return {
                decision: renderStructuredDecision(structuredDecision),
                structuredDecision,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
                decision: `${result}\n\n---\n结构化解析失败：${message}`,
                structuredDecision: null,
                error: message,
            }
        }
    }
}

async function nodeValidateDecision(state: DecisionStateType): Promise<Partial<DecisionStateType>> {
    const issues: string[] = []
    const decision = state.structuredDecision
    const maxPosition = Math.round((state.capital ?? 5000) * 0.2)
    const validCodes = new Set(state.filteredQuotes.map((q: QuoteData) => q.code))

    if (!decision) {
        issues.push('结构化决策为空，可能是模型没有输出合法 JSON。')
    } else {
        if (decision.maxPositionPerTarget > maxPosition) {
            issues.push(
                `结构化结果中的单标的最大仓位 ${decision.maxPositionPerTarget} 元超过规则上限 ${maxPosition} 元。`
            )
        }

        for (const pick of decision.picks) {
            if (!validCodes.has(pick.code)) {
                issues.push(`${pick.code} ${pick.name} 不在技术过滤和风控检查后的有效候选池中。`)
            }
            if (pick.positionAmount > maxPosition) {
                issues.push(
                    `${pick.code} ${pick.name} 仓位 ${pick.positionAmount} 元超过单标的上限 ${maxPosition} 元。`
                )
            }
            if (
                pick.action === 'watch' &&
                (pick.aggressiveEntry === null || pick.stopLoss === null)
            ) {
                issues.push(`${pick.code} ${pick.name} 是观察标的，但缺少激进挂或止损价。`)
            }
        }
    }

    if (issues.length === 0) {
        return {
            validationIssues: [],
            workflowNotes: ['决策校验通过：未发现仓位、候选池或关键价位违规。'],
        }
    }

    return {
        validationIssues: issues,
        decision: `${state.decision}\n\n---\n**程序校验提示**\n${issues.map((item) => `- ${item}`).join('\n')}`,
        workflowNotes: [`决策校验发现 ${issues.length} 个问题。`],
    }
}

// ─── 5. 构建图 ────────────────────────────────────────────────────────────────
export function buildDecisionGraph(
    provider: AIProvider,
    apiKey: string,
    baseUrl?: string,
    model?: string
) {
    const llm = createLLM(provider, apiKey, baseUrl, model)

    const graph = new StateGraph(DecisionState)
        // 注册节点
        .addNode('fetchNews', nodesFetchNews)
        .addNode('analyzeMarket', buildAnalyzeMarketNode(llm))
        .addNode('discoverCandidates', nodeDiscoverCandidates)
        .addNode('fetchQuotes', nodesFetchQuotes)
        .addNode('technicalFilter', nodeTechnicalFilter)
        .addNode('riskCheck', nodeRiskCheck)
        .addNode('makeDecision', buildMakeDecisionNode(llm))
        .addNode('validateDecision', nodeValidateDecision)

        // 定义边（执行顺序）
        .addEdge('__start__', 'fetchNews')
        .addEdge('fetchNews', 'analyzeMarket')
        .addEdge('analyzeMarket', 'discoverCandidates')
        .addEdge('discoverCandidates', 'fetchQuotes')
        .addEdge('fetchQuotes', 'technicalFilter')
        .addEdge('technicalFilter', 'riskCheck')
        .addEdge('riskCheck', 'makeDecision')
        .addEdge('makeDecision', 'validateDecision')
        .addEdge('validateDecision', END)

    return graph.compile()
}

// ─── 6. 对外入口 ──────────────────────────────────────────────────────────────
export interface AgentDecisionInput {
    provider: AIProvider
    apiKey: string
    baseUrl?: string
    model?: string
    date: string
    candidateCodes: Array<{ code: string; name: string }>
    capital?: number
    riskLevel?: string
    userProfile?: string
}

export interface AgentDecisionOutput {
    marketContext: string
    decision: string
    structuredDecision: StructuredDecision | null
    quotes: QuoteData[]
    diagnostics: AgentDiagnostics
}

export async function runDecisionAgent(input: AgentDecisionInput): Promise<AgentDecisionOutput> {
    const app = buildDecisionGraph(input.provider, input.apiKey, input.baseUrl, input.model)

    const result = await app.invoke({
        date: input.date,
        capital: input.capital ?? 5000,
        riskLevel: input.riskLevel ?? '平衡',
        userProfile: input.userProfile ?? '',
        candidateCodes: input.candidateCodes,
    })

    return {
        marketContext: result.marketContext || '',
        decision: result.decision || '',
        structuredDecision: result.structuredDecision || null,
        quotes: result.quotes || [],
        diagnostics: {
            discoveredCandidates: result.discoveredCandidates || [],
            filterNotes: result.filterNotes || [],
            riskWarnings: result.riskWarnings || [],
            validationIssues: result.validationIssues || [],
            workflowNotes: result.workflowNotes || [],
            quoteCount: result.quotes?.length || 0,
            filteredQuoteCount: result.filteredQuotes?.length || 0,
        },
    }
}
