/**
 * LangGraph Agent - 每日决策流程（多智能体版）
 *
 * 学习要点：
 * 1. StateGraph / Annotation — 把决策流程建模成有向图，节点共享一份状态
 * 2. 条件边 + fan-out         — prepareResearch 后可返回节点数组，并行分发到多头/空头
 * 3. fan-in                   — makeDecision 有两条入边，等多头、空头都完成后只运行一次
 * 4. 多智能体分工             — 分析师层(技术面/基本面/消息面) → 研究员层(多头/空头辩论)
 *                               → 裁判(makeDecision) 综合 → 风控官(riskControl) 最后踩刹车
 * 5. LLM proposes, code enforces — 风控官只输出结构化裁决(keep/downgrade/veto)，
 *                               由代码确定性地应用，且只允许让结果更保守
 *
 * 图结构：
 *   fetchNews → assessRegime →(cash?)→ cashObserve → END
 *                            └(否则)→ analyzeMarket → discoverCandidates → fetchQuotes
 *                              → technicalFilter → riskCheck → prepareResearch
 *                              →(有候选?)→ [技术面/基本面/消息面分析师] → [多头, 空头] → makeDecision
 *                                        └(无候选)──────────────────────────────────→ makeDecision
 *                              → riskControl → validateDecision → END
 */

import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
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
import { createChatModel } from './llm'
import { formatHoldingsSummary, getAllHoldings, getAllWatchlist } from '../db'
import { assessMarketRegime, type MarketRegime } from './marketRegime'
import { fetchFundamentals, fundamentalsToCompactLine } from './fundamentals'

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

// 风控官结构化裁决：LLM 只负责「提议」，代码负责「执行」（LLM proposes, code enforces）
const RiskVerdictSchema = z.object({
    overallNote: z.string(),
    adjustments: z.array(
        z.object({
            code: z.string(),
            // keep=维持；downgrade=降仓；veto=一票否决（改为回避、清仓位）
            verdict: z.enum(['keep', 'downgrade', 'veto']),
            reason: z.string(),
            // downgrade 时可给出建议仓位（元）；代码只会取更小值，不会放大
            suggestedPositionAmount: z.coerce.number().int().nonnegative().nullable(),
        })
    ),
})

type RiskVerdict = z.infer<typeof RiskVerdictSchema>

export interface AgentDiagnostics {
    discoveredCandidates: Array<{ code: string; name: string }>
    filterNotes: string[]
    riskWarnings: string[]
    validationIssues: string[]
    workflowNotes: string[]
    quoteCount: number
    filteredQuoteCount: number
    // 多智能体产物（可选，便于前端做归因展示）
    bullResearch?: string
    bearResearch?: string
    riskVerdicts?: string[]
    // 分析师层报告
    technicalAnalysis?: string
    fundamentalAnalysis?: string
    newsAnalysis?: string
}

// ─── 2. 图的状态定义 ─────────────────────────────────────────────────────────
// Annotation.Root 定义整张图共享的状态结构
// reducer 决定多次写入同一字段时如何合并（这里用最新值覆盖）
const DecisionState = Annotation.Root({
    date: Annotation<string>({ reducer: (_: string, b: string) => b }),
    capital: Annotation<number>({ reducer: (_: number, b: number) => b, default: () => 5000 }),
    riskLevel: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '平衡' }),
    userProfile: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
    holdingsSummary: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
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
    marketRegime: Annotation<MarketRegime | null>({
        reducer: (_: MarketRegime | null, b: MarketRegime | null) => b,
        default: () => null,
    }),
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
    // 进入辩论/决策的最终候选（已按 regime 上限截断），bull/bear/裁判共用同一份
    researchCandidates: Annotation<QuoteData[]>({
        reducer: (_: QuoteData[], b: QuoteData[]) => b,
        default: () => [],
    }),
    // 候选行情摘要文本（含参考价位），供多空研究员与裁判共享，避免各自重算
    candidateBrief: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
    // 候选基本面摘要文本
    fundamentalsBrief: Annotation<string>({
        reducer: (_: string, b: string) => b,
        default: () => '',
    }),
    // 分析师层报告：技术面 / 基本面 / 消息面（各由专职分析师产出，喂给多空研究员）
    technicalAnalysis: Annotation<string>({
        reducer: (_: string, b: string) => b,
        default: () => '',
    }),
    fundamentalAnalysis: Annotation<string>({
        reducer: (_: string, b: string) => b,
        default: () => '',
    }),
    newsAnalysis: Annotation<string>({
        reducer: (_: string, b: string) => b,
        default: () => '',
    }),
    // 多头研究员论据
    bullResearch: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
    // 空头研究员论据
    bearResearch: Annotation<string>({ reducer: (_: string, b: string) => b, default: () => '' }),
    // 风控官对每只标的的裁决说明（append）
    riskVerdicts: Annotation<string[]>({
        reducer: (a: string[], b: string[]) => [...a, ...b],
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
// ─── 2. LLM 实例 ─────────────────────────────────────────────────────────────
// 复用共享工厂（见 llm.ts）；决策场景用 temperature 0.7
function createLLM(provider: AIProvider, apiKey: string, baseUrl?: string, model?: string) {
    return createChatModel(provider, apiKey, baseUrl, model, 0.7)
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
7. 用户画像只代表长期偏好和约束，不代表市场事实。
8. 用户当前持仓是本地记录的事实。若候选标的已被用户持有，优先给"加仓/减仓/持有观察"建议而非新建仓，并在 reason 里说明；若候选与已持仓标的同属一个行业且该行业已高配，应在 reason 里提示行业集中度风险。
9. 今日市场状态（marketRegime）是客观指标的硬约束：defensive 态应偏谨慎、仓位靠下限、reason 提示防守；cash 态不会进入此节点（已提前观望）。不要与 marketRegime 的结论冲突。
10. 候选标的基本面（PE/PB/ROE/毛利率/营收净利同比等）是客观财务数据：优先选 ROE 稳定、毛利率高、营收净利正增长的标的；回避 PE 极高且成长停滞甚至负增长的标的。在 reason 里结合基本面说明取舍理由（如"PE 22 倍处于合理区间，ROE 30%+ 盈利能力强"）。基本面数据缺失时不要编造，按技术面决策。
11. 你是这场多空辩论的最终裁判：下面提供了「多头研究员」和「空头研究员」对同一批候选的对立观点。你要综合双方论据独立裁决，而不是简单采信某一方；当空头指出的风险成立时，应体现在更谨慎的 action、更低的 positionAmount 或更明确的 noBuyCondition 上。reason 里要说明你为何采信或否定了某方观点。`,
    ],
    [
        'human',
        `可用资金：{capital} 元
风险偏好：{riskLevel}
用户长期投资画像：
{userProfile}

用户当前持仓（成本口径，不含实时价）：
{holdingsSummary}

今日市场背景：{marketContext}
今日市场状态（客观指标，硬约束）：{marketRegime}
单标的最大仓位：{maxPosition} 元

风控提示：
{riskWarnings}

候选标的基本面（客观财务数据，供参考）：
{fundamentals}

有效候选池：
{candidates}

━━━ 多头研究员观点（看多理由）━━━
{bullResearch}

━━━ 空头研究员观点（看空/风险）━━━
{bearResearch}

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
      "reason": "基于这只标的自身数据的理由；若用户已持有，说明是加仓/减仓/持有观察建议",
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
// ─── 分析师层 prompt（技术面 / 基本面 / 消息面）─────────────────────────────
// 三个专职分析师各自出一份聚焦报告，作为多空研究员辩论的输入（对标 TradingAgents 的分析师层）
const technicalAnalystTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是A股「技术面分析师」。只从量价/技术角度分析下列候选，不谈基本面、不谈消息。
规则：
1. 逐只标的分析：当日涨跌与日内位置（开高低收）、是否放量/缩量、距日内高低点的相对位置、短线强弱。
2. 只依据给定行情数据，不编造均线/指标数值；数据不足就说"数据有限"。
3. 每只 2-3 条要点，用"代码 名称："开头，给一个技术面倾向（偏强/中性/偏弱）。
4. 不要 JSON，不要给买卖价位。`,
    ],
    [
        'human',
        `候选池行情（含日内开高低、参考价位）：
{candidates}

请逐只给出技术面分析。`,
    ],
])

const fundamentalAnalystTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是A股「基本面分析师」。只从财务/估值角度分析下列候选，不谈技术、不谈消息。
规则：
1. 逐只标的分析：PE/PB 估值高低、ROE 与盈利质量、毛利率、营收/净利同比成长性。
2. 只依据给定基本面数据，缺失就明说"无基本面数据"，不要编造。
3. 每只 2-3 条要点，用"代码 名称："开头，给一个基本面倾向（优质/一般/有瑕疵）。
4. 不要 JSON，不要给买卖价位。`,
    ],
    [
        'human',
        `候选标的基本面（客观财务数据）：
{fundamentals}

对应候选：
{candidates}

请逐只给出基本面分析。`,
    ],
])

const newsAnalystTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是A股「消息面分析师」。只从市场主线/板块/事件角度分析，判断下列候选是否踩中今日热点或有利空。
规则：
1. 结合今日市场背景与领涨板块，判断每只候选所属方向是今日主线、跟风还是回避方向。
2. 只依据给定的市场背景，不编造具体新闻；无法判断就说"缺少针对性消息"。
3. 每只 2-3 条要点，用"代码 名称："开头，给一个消息面倾向（顺风/中性/逆风）。
4. 不要 JSON，不要给买卖价位。`,
    ],
    [
        'human',
        `今日市场背景：{marketContext}

候选池：
{candidates}

请逐只给出消息面分析。`,
    ],
])

// 多头研究员：只找看多理由，不做最终决策
const bullTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是A股「多头研究员」。你的唯一任务是为下面的候选标的挖掘看多理由，站在乐观一方尽力论证。
规则：
1. 在三位分析师（技术面/基本面/消息面）报告的基础上综合论证看多逻辑，可引用他们的结论。
2. 只讲多头视角，但不许编造数据；只能引用给定的分析、行情与基本面。
3. 简洁，每只标的 2-4 条要点，用"代码 名称："开头。
4. 不要输出 JSON，不要给买卖价位，这一步只做论证。`,
    ],
    [
        'human',
        `今日市场背景：{marketContext}

━━━ 技术面分析师 ━━━
{technicalAnalysis}

━━━ 基本面分析师 ━━━
{fundamentalAnalysis}

━━━ 消息面分析师 ━━━
{newsAnalysis}

候选池行情：
{candidates}

请在分析师报告基础上，逐只给出看多理由。`,
    ],
])

// 空头研究员：只找看空/风险理由，与多头对立
const bearTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是A股「空头研究员」。你的唯一任务是为下面的候选标的挑毛病、找风险，站在谨慎一方尽力反驳买入。
规则：
1. 在三位分析师（技术面/基本面/消息面）报告的基础上找出被忽视的风险，可反驳他们偏乐观的结论。
2. 只讲空头视角，但不许编造数据；只能引用给定的分析、行情与基本面。
3. 简洁，每只标的 2-4 条要点，用"代码 名称："开头。
4. 不要输出 JSON，不要给买卖价位，这一步只做论证。`,
    ],
    [
        'human',
        `今日市场背景：{marketContext}

━━━ 技术面分析师 ━━━
{technicalAnalysis}

━━━ 基本面分析师 ━━━
{fundamentalAnalysis}

━━━ 消息面分析师 ━━━
{newsAnalysis}

候选池行情：
{candidates}

请在分析师报告基础上，逐只给出看空/风险理由。`,
    ],
])

// 风控官：审阅裁判的初步决策，只能让结果更保守（一票否决/降仓），不能放大仓位
const riskControlTemplate = ChatPromptTemplate.fromMessages([
    [
        'system',
        `你是独立于决策的「风控官」，最后一道防线。你不重新选股，只审阅已生成的决策并决定是否踩刹车。
规则：
1. 你只能让结果更保守：keep（维持）、downgrade（降仓）、veto（一票否决，改为回避）。绝不允许提高仓位或新增标的。
2. 重点关注：单标的仓位是否偏重、题材是否过度集中、空头研究员指出的重大风险是否已被裁判忽视、market/regime 是否要求防守。
3. 只输出合法 JSON，不要 Markdown，不要 \`\`\`json 包裹。
4. adjustments 里 code 必须来自下方"当前决策标的"，reason 用一句话说明裁决依据。
5. downgrade 时 suggestedPositionAmount 给出建议仓位（元，需≤原仓位）；keep/veto 时该字段填 null。`,
    ],
    [
        'human',
        `今日市场状态（硬约束）：{marketRegime}
单标的最大仓位：{maxPosition} 元

空头研究员风险提示：
{bearResearch}

当前决策标的（裁判初步结论）：
{picks}

请按下面 JSON 结构输出：
{{
  "overallNote": "一句话总体风控意见",
  "adjustments": [
    {{ "code": "股票代码", "verdict": "keep | downgrade | veto", "reason": "裁决依据", "suggestedPositionAmount": null }}
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

// 空指标占位，用于 regime 判断失败时的兜底
function emptyIndexIndicators(name: string, code: string): MarketRegime['indicators']['shIndex'] {
    return {
        name, code, price: null, todayChangePct: null, ma5: null, ma20: null,
        aboveMa20: null, ma5AboveMa20: null, ret5d: null, ret20d: null, volumeRatio: null,
    }
}

function defensiveRegimeFallback(reason: string): MarketRegime {
    return {
        regime: 'defensive',
        score: 0,
        indicators: {
            shIndex: emptyIndexIndicators('上证指数', '000001'),
            szIndex: emptyIndexIndicators('创业板指', '399006'),
        },
        rationale: `市场状态判断失败：${reason}，按防守态处理（仓位上限 15%）。`,
        suggestedMaxPositionRatio: 0.15,
        suggestedCandidateCount: 2,
    }
}

// 市场状态判断节点（纯规则，非 LLM）：判进攻/防守/空仓三态
// assessMarketRegime 内部已对数据源失败降级，此处 try/catch 为最后兜底
async function nodeAssessMarketRegime(
    state: DecisionStateType
): Promise<Partial<DecisionStateType>> {
    try {
        const regime = await assessMarketRegime()
        return {
            marketRegime: regime,
            workflowNotes: [
                `市场状态判断：${regime.regime}（得分 ${regime.score}），建议仓位上限 ${(regime.suggestedMaxPositionRatio * 100).toFixed(0)}%、候选数 ${regime.suggestedCandidateCount}。${regime.rationale}`,
            ],
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
            marketRegime: defensiveRegimeFallback(msg),
            workflowNotes: [`市场状态判断异常，降级防守：${msg}`],
        }
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
        if (discoveredCandidates.length > 0) {
            return {
                candidateCodes: discoveredCandidates,
                discoveredCandidates,
                workflowNotes: [
                    `候选池为空，Agent 从今日领涨板块自动发现 ${discoveredCandidates.length} 个候选标的。`,
                ],
            }
        }
        // 领涨板块接口可用但没返回标的时，走下方兜底
        return discoverFallback('今日领涨板块接口未返回候选')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // 领涨板块接口失败（常见于盘后/被反爬）：兜底用用户自己的持仓 / 自选股
        return discoverFallback(`自动发现候选池失败：${message}`)
    }
}

// 兜底候选：领涨板块发现不到时，用用户的持仓，其次自选股，让「今日计划」仍能基于自己的股票生成
function discoverFallback(reason: string): Partial<DecisionStateType> {
    const notes = [reason]
    try {
        const holdings = getAllHoldings()
            .map((h) => ({ code: String(h.code), name: String(h.name) }))
            .filter((h) => /^\d{6}$/.test(h.code))
        if (holdings.length > 0) {
            const picked = holdings.slice(0, 12)
            notes.push(`改用你的持仓 ${picked.length} 只作为候选池。`)
            return { candidateCodes: picked, discoveredCandidates: picked, workflowNotes: notes }
        }
        const watch = (getAllWatchlist() as Array<{ code: string; name: string }>)
            .map((w) => ({ code: String(w.code), name: String(w.name) }))
            .filter((w) => /^\d{6}$/.test(w.code))
        if (watch.length > 0) {
            const picked = watch.slice(0, 12)
            notes.push(`改用你的自选股 ${picked.length} 只作为候选池。`)
            return { candidateCodes: picked, discoveredCandidates: picked, workflowNotes: notes }
        }
        notes.push('且你还没有持仓/自选股可用作候选，请在观察列表添加后再试。')
    } catch (e) {
        notes.push(`兜底读取持仓/自选失败：${e instanceof Error ? e.message : String(e)}`)
    }
    return { discoveredCandidates: [], workflowNotes: notes }
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

// 单标的最大仓位（元）：由 regime 动态决定，缺失时回退 0.2。makeDecision / riskControl / validate 共用同一口径
function computeMaxPosition(state: DecisionStateType): number {
    const positionRatio = state.marketRegime?.suggestedMaxPositionRatio ?? 0.2
    return Math.round((state.capital ?? 5000) * positionRatio)
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

// 研究准备节点：把最终候选（按 regime 截断）+ 参考价位 + 基本面整理成文本，
// 供多头研究员、空头研究员、裁判三方共享，避免各自重复计算与重复拉取基本面
async function nodePrepareResearch(
    state: DecisionStateType
): Promise<Partial<DecisionStateType>> {
    if (state.filteredQuotes.length === 0) {
        return {
            researchCandidates: [],
            candidateBrief: '',
            fundamentalsBrief: '',
            workflowNotes: ['无有效候选，跳过多空辩论。'],
        }
    }

    // 候选数按 regime 上限截断（防守态减半，进攻态满额）
    const regime = state.marketRegime
    const candidateCap = regime?.suggestedCandidateCount ?? state.filteredQuotes.length
    const quotedCandidates = state.filteredQuotes.slice(0, Math.max(0, candidateCap))

    const candidateLines = quotedCandidates
        .map((q: QuoteData) => {
            const prices = calcReferencePrices(q)
            return `${q.code} ${q.name}
  现价 ${q.price}，今日 ${q.changePercent >= 0 ? '+' : ''}${q.changePercent}%
  日内：开 ${q.open}，高 ${q.high}，低 ${q.low}
  可用价位：aggressiveEntry=${prices.aggressive}, conservativeEntry=${prices.conservative}, stopLoss=${prices.stopLoss}, takeProfit=${prices.takeProfit}`
        })
        .join('\n\n')

    // 为最终候选并行拉取基本面（失败静默跳过，不阻塞决策）
    const fundamentalsResults = await Promise.allSettled(
        quotedCandidates.map((q: QuoteData) => fetchFundamentals(q.code))
    )
    const fundamentalsLines: string[] = []
    for (const r of fundamentalsResults) {
        if (r.status === 'fulfilled' && r.value.reportDate !== null) {
            fundamentalsLines.push(fundamentalsToCompactLine(r.value))
        }
    }
    const fundamentalsBlock =
        fundamentalsLines.length > 0 ? fundamentalsLines.join('\n') : '无基本面数据'

    return {
        researchCandidates: quotedCandidates,
        candidateBrief: candidateLines,
        fundamentalsBrief: fundamentalsBlock,
        workflowNotes: [`研究准备完成：进入辩论的候选 ${quotedCandidates.length} 个。`],
    }
}

// ─── 分析师层节点（技术面 / 基本面 / 消息面）──────────────────────────────────
// 三者并行，各出一份聚焦报告，作为多空研究员的输入
function buildTechnicalAnalystNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([technicalAnalystTemplate, llm, new StringOutputParser()])
    return async function nodeTechnicalAnalyst(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        if (state.researchCandidates.length === 0) return { technicalAnalysis: '' }
        const technicalAnalysis = await chain.invoke({
            candidates: state.candidateBrief || '无候选',
        })
        return { technicalAnalysis, workflowNotes: ['技术面分析师已出具报告。'] }
    }
}

function buildFundamentalAnalystNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([fundamentalAnalystTemplate, llm, new StringOutputParser()])
    return async function nodeFundamentalAnalyst(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        if (state.researchCandidates.length === 0) return { fundamentalAnalysis: '' }
        const fundamentalAnalysis = await chain.invoke({
            fundamentals: state.fundamentalsBrief || '无基本面数据',
            candidates: state.candidateBrief || '无候选',
        })
        return { fundamentalAnalysis, workflowNotes: ['基本面分析师已出具报告。'] }
    }
}

function buildNewsAnalystNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([newsAnalystTemplate, llm, new StringOutputParser()])
    return async function nodeNewsAnalyst(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        if (state.researchCandidates.length === 0) return { newsAnalysis: '' }
        const newsAnalysis = await chain.invoke({
            marketContext: state.marketContext || '无市场背景',
            candidates: state.candidateBrief || '无候选',
        })
        return { newsAnalysis, workflowNotes: ['消息面分析师已出具报告。'] }
    }
}

// 多头研究员节点：只找看多理由
function buildBullResearchNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([bullTemplate, llm, new StringOutputParser()])
    return async function nodeBullResearch(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        if (state.researchCandidates.length === 0) return { bullResearch: '' }
        const bullResearch = await chain.invoke({
            marketContext: state.marketContext || '无市场背景',
            technicalAnalysis: state.technicalAnalysis || '无技术面分析',
            fundamentalAnalysis: state.fundamentalAnalysis || '无基本面分析',
            newsAnalysis: state.newsAnalysis || '无消息面分析',
            candidates: state.candidateBrief || '无候选',
        })
        return { bullResearch, workflowNotes: ['多头研究员已给出看多论据。'] }
    }
}

// 空头研究员节点：只找看空/风险理由
function buildBearResearchNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([bearTemplate, llm, new StringOutputParser()])
    return async function nodeBearResearch(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        if (state.researchCandidates.length === 0) return { bearResearch: '' }
        const bearResearch = await chain.invoke({
            marketContext: state.marketContext || '无市场背景',
            technicalAnalysis: state.technicalAnalysis || '无技术面分析',
            fundamentalAnalysis: state.fundamentalAnalysis || '无基本面分析',
            newsAnalysis: state.newsAnalysis || '无消息面分析',
            candidates: state.candidateBrief || '无候选',
        })
        return { bearResearch, workflowNotes: ['空头研究员已给出看空/风险论据。'] }
    }
}

// 空仓态节点：跳过选股与 LLM 决策，直接输出观望
// 当 marketRegime.regime === 'cash' 时由条件边路由到此
async function nodeCashObserve(
    state: DecisionStateType
): Promise<Partial<DecisionStateType>> {
    const regime = state.marketRegime
    const observeReason = regime?.rationale ?? '市场破位下行，建议空仓观望，今日不开新仓。'
    const structuredDecision: StructuredDecision = {
        summary: '市场状态为空仓态，今日建议观望，不开新仓。',
        marketBias: 'negative',
        maxPositionPerTarget: 0,
        observeReason,
        picks: [],
    }
    return {
        // 用 regime 说明作为市场背景，供前端展示与落库
        marketContext: regime?.rationale ?? '市场状态判断为空仓态，跳过选股。',
        decision: renderStructuredDecision(structuredDecision),
        structuredDecision,
        workflowNotes: ['市场状态为 cash（空仓态），跳过选股与 AI 决策，直接输出观望。'],
    }
}

function buildMakeDecisionNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([decisionTemplate, llm, new StringOutputParser()])

    return async function nodeMakeDecision(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        const capital = state.capital ?? 5000
        const regime = state.marketRegime
        const maxPosition = computeMaxPosition(state)

        // 候选为空（含 prepareResearch 直连的情况）：直接输出观望
        if (state.researchCandidates.length === 0) {
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

        const riskLevel = state.riskLevel ?? '平衡'
        const regimeSummary = regime
            ? `${regime.regime}（得分 ${regime.score}）：${regime.rationale}`
            : '未判断市场状态'
        // 裁判综合 prepareResearch 产出的候选/基本面，以及多空研究员的对立论据
        const result = await chain.invoke({
            capital,
            riskLevel,
            userProfile: state.userProfile || '未设置长期投资画像',
            holdingsSummary: state.holdingsSummary || '无持仓',
            marketContext: state.marketContext || '无市场背景',
            marketRegime: regimeSummary,
            riskWarnings:
                state.riskWarnings.length > 0
                    ? state.riskWarnings.map((item, i) => `${i + 1}. ${item}`).join('\n')
                    : '无',
            candidates: state.candidateBrief || '无候选',
            fundamentals: state.fundamentalsBrief || '无基本面数据',
            bullResearch: state.bullResearch || '（多头研究员无输出）',
            bearResearch: state.bearResearch || '（空头研究员无输出）',
            maxPosition,
        })

        try {
            const structuredDecision = StructuredDecisionSchema.parse(extractJson(result))
            return {
                decision: renderStructuredDecision(structuredDecision),
                structuredDecision,
                workflowNotes: ['裁判综合多空辩论，生成初步决策。'],
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

// 风控官节点：LLM 只「提议」keep/downgrade/veto，代码「执行」——只会让结果更保守
function buildRiskControlNode(llm: ReturnType<typeof createLLM>) {
    const chain = RunnableSequence.from([riskControlTemplate, llm, new StringOutputParser()])
    return async function nodeRiskControl(
        state: DecisionStateType
    ): Promise<Partial<DecisionStateType>> {
        const decision = state.structuredDecision
        // 没有可执行的买入/观察标的时，无需风控介入
        if (!decision || decision.picks.length === 0) {
            return { workflowNotes: ['无候选标的，风控官跳过。'] }
        }

        const maxPosition = computeMaxPosition(state)
        const regimeSummary = state.marketRegime
            ? `${state.marketRegime.regime}（得分 ${state.marketRegime.score}）：${state.marketRegime.rationale}`
            : '未判断市场状态'
        const picksText = decision.picks
            .map(
                (p) =>
                    `${p.code} ${p.name}｜优先级${p.priority}｜action=${p.action}｜仓位=${p.positionAmount}元｜理由：${p.reason}`
            )
            .join('\n')

        let verdict: RiskVerdict
        try {
            const raw = await chain.invoke({
                marketRegime: regimeSummary,
                maxPosition,
                bearResearch: state.bearResearch || '（空头研究员无输出）',
                picks: picksText,
            })
            verdict = RiskVerdictSchema.parse(extractJson(raw))
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
                workflowNotes: [`风控官裁决解析失败，保留原决策：${message}`],
            }
        }

        // 按 code 应用裁决；未提及的标的默认 keep
        const verdictByCode = new Map(verdict.adjustments.map((a) => [a.code, a]))
        const notes: string[] = []
        let changed = false

        const revisedPicks = decision.picks.map((pick) => {
            const adj = verdictByCode.get(pick.code)
            if (!adj || adj.verdict === 'keep') return pick

            if (adj.verdict === 'veto') {
                changed = true
                notes.push(`否决 ${pick.code} ${pick.name}：${adj.reason}`)
                return {
                    ...pick,
                    action: 'avoid' as const,
                    positionAmount: 0,
                    riskNote: `【风控否决】${adj.reason}｜${pick.riskNote}`,
                }
            }

            // downgrade：只允许调小仓位，绝不放大
            const suggested = adj.suggestedPositionAmount
            const target =
                suggested !== null && suggested < pick.positionAmount
                    ? suggested
                    : Math.floor(pick.positionAmount / 2)
            const newAmount = Math.max(0, Math.min(pick.positionAmount, target))
            changed = true
            notes.push(
                `降仓 ${pick.code} ${pick.name}：${pick.positionAmount}→${newAmount}元，${adj.reason}`
            )
            return {
                ...pick,
                positionAmount: newAmount,
                riskNote: `【风控降仓】${adj.reason}｜${pick.riskNote}`,
            }
        })

        const riskVerdicts = [
            `风控总评：${verdict.overallNote}`,
            ...(notes.length > 0 ? notes : ['风控官维持裁判决策，未做调整。']),
        ]

        if (!changed) {
            return {
                riskVerdicts,
                workflowNotes: ['风控官审阅完成：维持原决策。'],
            }
        }

        const revisedDecision: StructuredDecision = { ...decision, picks: revisedPicks }
        return {
            structuredDecision: revisedDecision,
            decision: renderStructuredDecision(revisedDecision),
            riskVerdicts,
            workflowNotes: [`风控官介入：调整 ${notes.length} 只标的。`],
        }
    }
}

async function nodeValidateDecision(state: DecisionStateType): Promise<Partial<DecisionStateType>> {
    const issues: string[] = []
    const decision = state.structuredDecision
    // 与 makeDecision 保持一致的 regime 口径仓位上限
    const maxPosition = computeMaxPosition(state)
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
        .addNode('assessRegime', nodeAssessMarketRegime)
        .addNode('analyzeMarket', buildAnalyzeMarketNode(llm))
        .addNode('discoverCandidates', nodeDiscoverCandidates)
        .addNode('fetchQuotes', nodesFetchQuotes)
        .addNode('technicalFilter', nodeTechnicalFilter)
        .addNode('riskCheck', nodeRiskCheck)
        .addNode('prepareResearch', nodePrepareResearch)
        .addNode('technicalAnalyst', buildTechnicalAnalystNode(llm))
        .addNode('fundamentalAnalyst', buildFundamentalAnalystNode(llm))
        .addNode('newsAnalyst', buildNewsAnalystNode(llm))
        .addNode('bullResearchNode', buildBullResearchNode(llm))
        .addNode('bearResearchNode', buildBearResearchNode(llm))
        .addNode('makeDecision', buildMakeDecisionNode(llm))
        .addNode('riskControl', buildRiskControlNode(llm))
        .addNode('validateDecision', nodeValidateDecision)
        .addNode('cashObserve', nodeCashObserve)

        // 定义边（执行顺序）
        .addEdge('__start__', 'fetchNews')
        .addEdge('fetchNews', 'assessRegime')
        // 市场状态判断后条件分流：cash 态跳过选股直接观望，否则走完整流程
        .addConditionalEdges('assessRegime', (state) =>
            state.marketRegime?.regime === 'cash' ? 'cashObserve' : 'analyzeMarket'
        )
        .addEdge('analyzeMarket', 'discoverCandidates')
        .addEdge('discoverCandidates', 'fetchQuotes')
        .addEdge('fetchQuotes', 'technicalFilter')
        .addEdge('technicalFilter', 'riskCheck')
        .addEdge('riskCheck', 'prepareResearch')
        // 有候选则并行 fan-out 到三位分析师；无候选直接给裁判走观望
        .addConditionalEdges('prepareResearch', (state) =>
            state.researchCandidates.length === 0
                ? 'makeDecision'
                : ['technicalAnalyst', 'fundamentalAnalyst', 'newsAnalyst']
        )
        // 三位分析师完成后 fan-in 到多头、空头研究员（各等三份报告齐了再跑一次）
        .addEdge('technicalAnalyst', 'bullResearchNode')
        .addEdge('fundamentalAnalyst', 'bullResearchNode')
        .addEdge('newsAnalyst', 'bullResearchNode')
        .addEdge('technicalAnalyst', 'bearResearchNode')
        .addEdge('fundamentalAnalyst', 'bearResearchNode')
        .addEdge('newsAnalyst', 'bearResearchNode')
        // fan-in：makeDecision 等多头、空头都完成后运行一次
        .addEdge('bullResearchNode', 'makeDecision')
        .addEdge('bearResearchNode', 'makeDecision')
        // 裁判出初步决策 → 风控官复核 → 程序校验
        .addEdge('makeDecision', 'riskControl')
        .addEdge('riskControl', 'validateDecision')
        .addEdge('validateDecision', END)
        .addEdge('cashObserve', END)

    return graph.compile()
}

// ─── 6. 对外入口 ──────────────────────────────────────────────────────────────
// ─── 6. 对外入口 ──────────────────────────────────────────────────────────────
// 各节点的中文标签，用于流式进度提示（前端逐步显示 Agent 团队推进到哪一步）
const NODE_LABELS: Record<string, string> = {
    fetchNews: '拉取快讯与板块',
    assessRegime: '判断市场状态',
    analyzeMarket: '分析市场主线',
    discoverCandidates: '发现候选标的',
    fetchQuotes: '拉取候选行情',
    technicalFilter: '技术过滤',
    riskCheck: '风控筛查',
    prepareResearch: '准备研究材料',
    technicalAnalyst: '🔬 技术面分析师',
    fundamentalAnalyst: '📊 基本面分析师',
    newsAnalyst: '📰 消息面分析师',
    bullResearchNode: '🐂 多头研究员',
    bearResearchNode: '🐻 空头研究员',
    makeDecision: '🧑‍⚖️ 裁判综合决策',
    riskControl: '🛡️ 风控官复核',
    validateDecision: '决策校验',
    cashObserve: '空仓观望',
}

export interface DecisionProgress {
    node: string
    label: string
}

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
    marketRegime: MarketRegime | null
}

export async function runDecisionAgent(
    input: AgentDecisionInput,
    onProgress?: (progress: DecisionProgress) => void
): Promise<AgentDecisionOutput> {
    const app = buildDecisionGraph(input.provider, input.apiKey, input.baseUrl, input.model)

    // 用 stream 同时拿「节点更新」(做进度提示) 和「完整状态快照」(做最终结果)
    // streamMode 数组会 yield [mode, chunk] 元组
    const stream = await app.stream(
        {
            date: input.date,
            capital: input.capital ?? 5000,
            riskLevel: input.riskLevel ?? '平衡',
            userProfile: input.userProfile ?? '',
            holdingsSummary: formatHoldingsSummary(),
            candidateCodes: input.candidateCodes,
        },
        { streamMode: ['updates', 'values'] }
    )

    let result: Partial<DecisionStateType> = {}
    for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
        if (mode === 'updates') {
            // chunk 形如 { 节点名: 局部状态更新 }
            const node = Object.keys(chunk as Record<string, unknown>)[0]
            if (node && onProgress) {
                onProgress({ node, label: NODE_LABELS[node] ?? node })
            }
        } else if (mode === 'values') {
            // 每步的完整状态快照，最后一个即最终状态
            result = chunk as Partial<DecisionStateType>
        }
    }

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
            bullResearch: result.bullResearch || '',
            bearResearch: result.bearResearch || '',
            riskVerdicts: result.riskVerdicts || [],
            technicalAnalysis: result.technicalAnalysis || '',
            fundamentalAnalysis: result.fundamentalAnalysis || '',
            newsAnalysis: result.newsAnalysis || '',
        },
        marketRegime: result.marketRegime || null,
    }
}
