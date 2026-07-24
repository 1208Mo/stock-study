export type AIProvider = 'openai' | 'deepseek' | 'qwen' | 'ernie' | 'volcengine'

export interface AIMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface AIResponse {
    content: string
    model: string
    provider: AIProvider
}

export interface ProviderConfig {
    apiKey: string
    baseUrl?: string
    model?: string
}

// 流式回调类型（用于对话页）
export type StreamCallback = (chunk: string, done: boolean) => void

function formatAIError(
    error: unknown,
    provider: AIProvider,
    baseUrl: string,
    model: string
): Error {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const response = (error as { response?: { status?: number; data?: unknown } }).response
        const data = response?.data
        const detail =
            typeof data === 'string'
                ? data
                : data && typeof data === 'object'
                  ? JSON.stringify(data)
                  : '无返回详情'
        return new Error(
            `AI 调用失败：${provider} / ${model}，HTTP ${response?.status ?? '未知'}，接口 ${baseUrl}。返回：${detail}`
        )
    }

    if (error instanceof Error) {
        return new Error(`AI 调用失败：${provider} / ${model}，接口 ${baseUrl}。${error.message}`)
    }

    return new Error(`AI 调用失败：${provider} / ${model}，接口 ${baseUrl}。${String(error)}`)
}

const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    ernie: { baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k-preview' },
    volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
}

async function callOpenAICompatible(
    provider: AIProvider,
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: AIMessage[]
): Promise<string> {
    const { default: axios } = await import('axios')

    try {
        const resp = await axios.post(
            `${baseUrl.replace(/\/$/, '')}/chat/completions`,
            { model, messages, temperature: 0.7, max_tokens: 2000 },
            {
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 60000,
            }
        )
        return resp.data.choices[0].message.content
    } catch (error) {
        throw formatAIError(error, provider, baseUrl, model)
    }
}

export async function callAI(
    provider: AIProvider,
    config: ProviderConfig,
    messages: AIMessage[]
): Promise<AIResponse> {
    const defaults = PROVIDER_DEFAULTS[provider]
    const baseUrl = config.baseUrl || defaults.baseUrl
    const model = config.model || defaults.model

    const content = await callOpenAICompatible(provider, baseUrl, config.apiKey, model, messages)

    return { content, model, provider }
}

export function buildChatSystemPrompt(): AIMessage {
    return {
        role: 'system',
        content: `你是一个A股投资入门助手，服务对象是零基础新手投资者。

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
    }
}

export function buildStockAnalysisPrompt(
    stockName: string,
    stockCode: string,
    price: number,
    changePercent: number,
    extraContext?: string
): AIMessage[] {
    const isEtf =
        stockName.includes('ETF') || stockCode.startsWith('5') || stockCode.startsWith('1')
    const aggressiveEntry = (price * (isEtf ? 0.995 : 0.99)).toFixed(3)
    const conservativeEntry = (price * (isEtf ? 0.985 : 0.975)).toFixed(3)
    const stopLoss = (price * (isEtf ? 0.97 : 0.963)).toFixed(3)
    const takeProfit1 = (price * (isEtf ? 1.025 : 1.04)).toFixed(3)
    const takeProfit2 = (price * (isEtf ? 1.05 : 1.08)).toFixed(3)

    return [
        {
            role: 'system',
            content: `你是一个A股分析助手，擅长逻辑面、基本面和技术面综合分析，服务对象是新手投资者。
输出要求：
1. 语言简洁，每个板块不超过4句话。
2. 价位建议直接使用用户提供的现价计算；系数已预填，直接引用即可。
3. 不保证收益，不发出买卖指令，给出的是"观察条件"和"参考价位"。
4. 所有分析仅供参考，不构成投资建议。`,
        },
        {
            role: 'user',
            content: `请对以下股票做综合分析并给出买卖价位参考：

股票名称：${stockName}
股票代码：${stockCode}
当前价格：${price} 元
今日涨跌幅：${changePercent}%
${extraContext ? `\n补充信息：${extraContext}` : ''}

已预算的参考价位（基于现价 ${price} 元）：
- 激进买入：${aggressiveEntry}（现价 × ${isEtf ? '0.995' : '0.990'}）
- 保守买入：${conservativeEntry}（现价 × ${isEtf ? '0.985' : '0.975'}）
- 止损线：${stopLoss}（现价 × ${isEtf ? '0.970' : '0.963'}，跌破不补仓）
- 第一止盈：${takeProfit1}（现价 × ${isEtf ? '1.025' : '1.040'}）
- 第二止盈：${takeProfit2}（现价 × ${isEtf ? '1.050' : '1.080'}）

请按以下格式输出：

**结论快照**
[一句话：偏强/偏弱/观望，及最关键原因]

**逻辑面**
[这只股票/ETF 的核心逻辑是什么？当前是否有催化剂或政策支持？]

**基本面**
[营收/利润趋势、估值位置、行业地位简评。ETF 则说明跟踪指数成分和当前估值分位。]

**技术面**
[短期趋势、量能、关键支撑压力位简评]

**买卖价位参考**
- 激进买入：${aggressiveEntry}（回踩小仓可挂）
- 保守买入：${conservativeEntry}（等明显回踩）
- 止损线：${stopLoss}（跌破不补仓直接出）
- 第一止盈：${takeProfit1}（可减半仓）
- 第二止盈：${takeProfit2}（强势才持到）

**不买条件**
- [条件1：如今日涨幅已超X%]
- [条件2：如接近日内高点]
- [条件3：如板块或大盘转弱]

**主要风险**
[3条最关键的下行风险]`,
        },
    ]
}

function calcEMA(closes: number[], period: number): number[] {
    const k = 2 / (period + 1)
    const result: number[] = []
    for (let i = 0; i < closes.length; i++) {
        result.push(
            i === 0 ? closes[0] : parseFloat((closes[i] * k + result[i - 1] * (1 - k)).toFixed(4))
        )
    }
    return result
}

function calcMACDValues(closes: number[]): { dif: number; dea: number; bar: number } | null {
    if (closes.length < 35) return null
    const ema12 = calcEMA(closes, 12)
    const ema26 = calcEMA(closes, 26)
    const difArr = closes.map((_, i) => ema12[i] - ema26[i])
    // DEA: 9-EMA of DIF from index 25 onward
    const k = 2 / (9 + 1)
    const deaArr: number[] = new Array(closes.length).fill(0)
    for (let i = 25; i < closes.length; i++) {
        deaArr[i] =
            i === 25 ? difArr[i] : parseFloat((difArr[i] * k + deaArr[i - 1] * (1 - k)).toFixed(4))
    }
    const last = closes.length - 1
    const prev = last - 1
    const dif = parseFloat(difArr[last].toFixed(3))
    const dea = parseFloat(deaArr[last].toFixed(3))
    const difPrev = parseFloat(difArr[prev].toFixed(3))
    const deaPrev = parseFloat(deaArr[prev].toFixed(3))
    const bar = parseFloat(((dif - dea) * 2).toFixed(3))
    const barPrev = parseFloat(((difPrev - deaPrev) * 2).toFixed(3))
    return { dif, dea, bar, barPrev, difPrev, deaPrev } as { dif: number; dea: number; bar: number }
}

export function buildKLineReadingPrompt(
    stockName: string,
    stockCode: string,
    klines: Array<{
        date: string
        open: number
        close: number
        high: number
        low: number
        volume: number
    }>,
    currentPrice: number,
    changePercent: number
): AIMessage[] {
    const closes = klines.map((k) => k.close)

    function calcMA(period: number): number | null {
        if (closes.length < period) return null
        const slice = closes.slice(-period)
        return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(3))
    }

    const ma5 =
        calcMA(5) ??
        parseFloat(
            (closes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, closes.length)).toFixed(3)
        )
    const ma10 =
        calcMA(10) ??
        parseFloat(
            (closes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, closes.length)).toFixed(3)
        )
    const ma20 = calcMA(20)
    const ma30 = calcMA(30)

    // 取最近 10 根 K 线给 AI，减少 token 用量，避免超时
    const recent = klines.slice(-10)
    const maxHigh = Math.max(...recent.map((k) => k.high))
    const minLow = Math.min(...recent.map((k) => k.low))
    const avgVol = recent.map((k) => k.volume).reduce((a, b) => a + b, 0) / recent.length
    const lastVol = recent[recent.length - 1]?.volume ?? 0
    const volRatio = (lastVol / avgVol).toFixed(2)
    const klineText = recent
        .map(
            (k) =>
                `${k.date} 开${k.open} 收${k.close} 高${k.high} 低${k.low} 量${(k.volume / 1e6).toFixed(0)}万`
        )
        .join('\n')
    const maLine = [
        `MA5: ${ma5.toFixed(3)}`,
        `MA10: ${ma10.toFixed(3)}`,
        ma20 != null ? `MA20: ${ma20}` : null,
        ma30 != null ? `MA30: ${ma30}` : null,
    ]
        .filter(Boolean)
        .join('，')

    const macdResult = calcMACDValues(closes) as
        | (ReturnType<typeof calcMACDValues> & {
              difPrev: number
              deaPrev: number
              barPrev: number
          })
        | null
    const macdLine = macdResult
        ? `DIF: ${macdResult.dif}，DEA: ${macdResult.dea}，MACD柱: ${macdResult.bar}（前日DIF: ${macdResult.difPrev}，前日DEA: ${macdResult.deaPrev}，前日柱: ${macdResult.barPrev}）`
        : '数据不足，无法计算'
    const macdSignal = macdResult
        ? (() => {
              const golden =
                  macdResult.difPrev < macdResult.deaPrev && macdResult.dif > macdResult.dea
              const death =
                  macdResult.difPrev > macdResult.deaPrev && macdResult.dif < macdResult.dea
              const aboveZero = macdResult.dif > 0 && macdResult.dea > 0
              const belowZero = macdResult.dif < 0 && macdResult.dea < 0
              const growing = macdResult.bar > macdResult.barPrev
              if (golden) return aboveZero ? '金叉（零轴上方，强信号）' : '金叉（零轴下方，弱信号）'
              if (death)
                  return belowZero ? '死叉（零轴下方，强空信号）' : '死叉（零轴上方，弱空信号）'
              return `${aboveZero ? '多头区域' : belowZero ? '空头区域' : '零轴附近'}，MACD柱${growing ? '扩大（动能增强）' : '收缩（动能减弱）'}`
          })()
        : '数据不足'

    return [
        {
            role: 'system',
            content: `你是A股短线交易助手，直接给操作结论，不废话。
要求：
1. 不解释概念，不科普K线和MACD，直接给判断和操作。
2. 每条结论必须有具体数字。
3. 不构成投资建议，只是参考。`,
        },
        {
            role: 'user',
            content: `${stockName}（${stockCode}）K线+MACD分析，直接给操作。

现价：${currentPrice} 元，今日涨跌幅：${changePercent}%
均线：${maLine}
MACD：${macdLine}
MACD信号：${macdSignal}
近期最高：${maxHigh}，近期最低：${minLow}
今日量是均量的 ${volRatio} 倍

最近10根日K：
${klineText}

请按这个格式输出：

**📊 趋势判断**
[一句话：看涨/看跌/震荡，及最关键理由（结合均线+MACD共同判断）]

**📌 操作建议**
- 买入时机：[具体条件+具体价格，如"收盘价站上 XX 元可小仓进"]
- 止损价：[具体价格]
- 止盈价：[具体价格1和价格2]
- 不操作条件：[什么情况下不动]

**⚠️ 明日关键价位**
- 上方压力：[价格]
- 下方支撑：[价格]
- 如果收盘在 [价格] 以上：[操作]
- 如果收盘在 [价格] 以下：[操作]`,
        },
    ]
}

export function buildDailyDecisionPrompt(
    capital: number,
    riskLevel: string,
    focus: string,
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
        // 可选扩展字段
        high?: number
        low?: number
        open?: number
        volume?: number
        avgVolume?: number
    }>
): AIMessage[] {
    const validCandidates = candidates.filter((c) => !c.noBuyReason)
    const skipped = candidates.filter((c) => c.noBuyReason)

    const candidateLines = validCandidates
        .map((item, index) => {
            const distFromHigh = item.high
                ? `距日内高点 ${(((item.high - item.price) / item.high) * 100).toFixed(1)}%`
                : ''
            const distFromLow = item.low
                ? `距日内低点 ${(((item.price - item.low) / item.low) * 100).toFixed(1)}%`
                : ''
            const volComment =
                item.volume && item.avgVolume
                    ? `量比 ${(item.volume / item.avgVolume).toFixed(2)}x`
                    : ''
            const openGap = item.open
                ? `开盘gap ${(((item.price - item.open) / item.open) * 100).toFixed(2)}%`
                : ''
            return `【候选${index + 1}】${item.code} ${item.name}
  现价 ${item.price}，今日 ${item.changePercent > 0 ? '+' : ''}${item.changePercent}%
  日内：开 ${item.open ?? 'N/A'}，高 ${item.high ?? 'N/A'}，低 ${item.low ?? 'N/A'}  ${distFromHigh}  ${distFromLow}
  量能：${volComment || 'N/A'}  ${openGap}
  参考价位（基于日/周K线支撑压力位推导，非分时线）：激进 ${item.aggressiveEntry}，保守 ${item.conservativeEntry}，止损 ${item.stopLoss}，止盈 ${item.takeProfit}`
        })
        .join('\n\n')

    const skippedLines =
        skipped.length > 0
            ? `\n已过滤（不参与决策）：${skipped.map((c) => `${c.code} ${c.name}（${c.noBuyReason}）`).join('；')}`
            : ''

    return [
        {
            role: 'system',
            content: `你是A股盘前决策助手，给新手一个今天"最值得关注的1-3只"，要区分出它们的差异和优先级，不能千篇一律。

规则：
1. 必须根据每只股票自身的涨跌幅、量能、距高低点距离等数据，给出差异化判断——不同候选理由必须不同。
2. 选出优先级后说清楚"为什么这只排第一而不是另一只"。
3. 若候选池中所有标的处境类似（如都在高位、都缩量），直接说今天观望，不强行推荐。
4. 仓位保守：单标的不超过可用资金20%，三个全买不超过50%。
5. 止损是硬规定，跌破不补仓。
6. 不追今日已大涨、接近日内高点的标的。
7. 参考价位是"日/周K线静态技术位"（激进=MA5浅回踩，保守=MA10/MA20/周线12周低点，止损=MA60或月线主要低点，止盈=近20/60日swing高点及周线24周高点），一天只在收盘后刷新——直接引用即可，**不要再按现价系数重新计算**。`,
        },
        {
            role: 'user',
            content: `今日交易决策请求：
可用资金：${capital} 元
风险偏好：${riskLevel}
关注方向：${focus || '综合机会'}
${skippedLines}

有效候选池：
${candidateLines || '（候选池为空）'}

任务：
1. 先对比所有候选的技术状态差异（涨幅位置、量能、距高低点），判断谁的赔率更好。
2. 然后按优先级1-2-3排列。
3. 用下面格式输出，每只候选的理由必须体现它自身的数据特点，不能套模板。

---
📌 优先级1：[代码 名称]
理由：[必须提到这只的具体数据，如"今日低开后量能回升，距日内高点还有X%空间，MACD未死叉"这类具体表述]

💰 买入价
- 激进挂：[价格]
- 保守挂：[价格]

🛑 止损线：[价格]（跌破直接出，不补仓）
🎯 止盈：[价格]
📦 仓位：[金额]（不超过 ${Math.round(capital * 0.2)} 元）

⚠️ 不买：[针对这只股票自身的具体风险条件，如"涨幅超过X%不追"或"跌破XX不进"]
---

（如有优先级2、3，重复上述格式；若候选只有1只，就只输出1个）

如果认为今天所有候选都不适合买：❌ 今天建议观望，原因：[一句话说清楚共同的不利因素]。`,
        },
    ]
}

export function buildMarketContextPrompt(
    headlines: string[],
    date: string,
    topSectors?: Array<{ name: string; changePercent: number }>,
    ambushSectors?: Array<{
        name: string
        changePercent: number
        return5d: number
        return10d: number
        volumeTrend: number
        distanceToHigh: number
        reasons: string[]
    }>
): AIMessage[] {
    const headlineText = headlines
        .slice(0, 25)
        .map((h, i) => `${i + 1}. ${h}`)
        .join('\n')
    const sectorText =
        topSectors && topSectors.length > 0
            ? `\n今日领涨板块（实时涨幅排行）：\n` +
              topSectors
                  .map(
                      (s, i) =>
                          `${i + 1}. ${s.name} ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`
                  )
                  .join('\n')
            : ''

    const ambushText =
        ambushSectors && ambushSectors.length > 0
            ? `\n潜伏候选板块（今日不热但有蓄势迹象，扫描全网100+板块得出）：\n` +
              ambushSectors
                  .map((s, i) => {
                      const reason =
                          s.reasons.length > 0 ? `，${s.reasons.join('、')}` : ''
                      return `${i + 1}. ${s.name}：今日 ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%，5日 ${s.return5d >= 0 ? '+' : ''}${s.return5d}%，10日 ${s.return10d >= 0 ? '+' : ''}${s.return10d}%，量比 ${s.volumeTrend}x，距20日高 ${s.distanceToHigh}%${reason}`
                  })
                  .join('\n')
            : ''

    return [
        {
            role: 'system',
            content: `你是A股市场分析师，根据今日财经快讯 + 板块数据（含"今日热点"与"潜伏候选"），快速提炼出：
1. 今日市场主线板块（涨/强的方向）
2. 今日回避方向（跌/弱的方向）
3. 潜伏机会板块（今日不热但已有蓄势迹象，可埋伏观察）
4. 针对主线和潜伏方向，推荐2-3只具体的A股代码（优先ETF，其次个股龙头）

输出格式简洁，直接给结论，不废话。`,
        },
        {
            role: 'user',
            content: `日期：${date}

今日东方财富财经快讯（共${headlines.length}条，取前25条）：
${headlineText}
${sectorText}
${ambushText}

请输出：

**📈 今日主线方向**
（按强弱排序，每个方向说明原因一句话）

**📉 今日回避方向**
（哪些板块今日偏弱或有利空）

**🕶️ 潜伏机会方向**
（结合上方"潜伏候选板块"数据，挑2-3个最值得关注的埋伏方向，说明为什么）

**🎯 今日推荐关注标的**
按方向给2-3个代码+名称，格式：
- 方向名（主线/潜伏）：代码1 名称1，代码2 名称2（说明理由）

**⚠️ 今日决策提示**
（一句话总结：今天适合做什么，回避什么）`,
        },
    ]
}

export function buildTradingTPrompt(
    stockName: string,
    stockCode: string,
    costPrice: number,
    holdQuantity: number,
    currentPrice: number,
    changePercent: number,
    todayOpen: number,
    todayHigh: number,
    todayLow: number,
    intraday: Array<{
        date: string
        open: number
        close: number
        high: number
        low: number
        volume: number
    }>
): AIMessage[] {
    // 5min MACD on intraday
    const intradayCloses = intraday.map((k) => k.close)
    const intradayMacd = calcMACDValues(intradayCloses)

    // 5min MA5/MA10
    const last5 = intradayCloses.slice(-5)
    const last10 = intradayCloses.slice(-10)
    const ma5 =
        last5.length > 0
            ? parseFloat((last5.reduce((a, b) => a + b, 0) / last5.length).toFixed(3))
            : null
    const ma10 =
        last10.length > 0
            ? parseFloat((last10.reduce((a, b) => a + b, 0) / last10.length).toFixed(3))
            : null

    const avgVol = intraday.map((k) => k.volume).reduce((a, b) => a + b, 0) / intraday.length
    const lastBar = intraday[intraday.length - 1]
    const volRatio = lastBar ? (lastBar.volume / avgVol).toFixed(2) : 'N/A'

    const macdLine = intradayMacd
        ? (() => {
              const m = intradayMacd as {
                  dif: number
                  dea: number
                  bar: number
                  difPrev: number
                  deaPrev: number
                  barPrev: number
              }
              const golden = m.difPrev < m.deaPrev && m.dif > m.dea
              const death = m.difPrev > m.deaPrev && m.dif < m.dea
              const signal = golden
                  ? '金叉'
                  : death
                    ? '死叉'
                    : m.dif > m.dea
                      ? 'DIF在DEA上方'
                      : 'DIF在DEA下方'
              return `DIF ${m.dif}，DEA ${m.dea}，柱 ${m.bar}（${signal}）`
          })()
        : '数据不足'

    const recentBars = intraday
        .slice(-12)
        .map(
            (k) =>
                `${k.date.slice(11)} 开${k.open} 收${k.close} 高${k.high} 低${k.low} 量${Math.round(k.volume / 100)}手`
        )
        .join('\n')

    const hasPosition = holdQuantity > 0
    const positionInfo = hasPosition
        ? `持仓成本：${costPrice} 元，持仓：${holdQuantity} 股，浮盈亏：${((currentPrice - costPrice) * holdQuantity).toFixed(0)} 元（${(((currentPrice - costPrice) / costPrice) * 100).toFixed(2)}%）`
        : '当前无持仓（空仓做T）'

    return [
        {
            role: 'system',
            content: `你是A股T+0短线助手，专注分时图做T操作，直接给步骤，不废话。
要求：
1. 每个步骤必须有具体价格。
2. 分持仓做T（高抛低吸降成本）和空仓做T（来回波段）两种情况。
3. 不构成投资建议，只是参考。`,
        },
        {
            role: 'user',
            content: `${stockName}（${stockCode}）做T分析，给步骤。

当前价：${currentPrice} 元，今日涨跌幅：${changePercent}%
今日：开 ${todayOpen}，高 ${todayHigh}，低 ${todayLow}
${positionInfo}

5分钟指标：
- 5min MA5: ${ma5 ?? 'N/A'}，MA10: ${ma10 ?? 'N/A'}
- 5min MACD：${macdLine}
- 最新一根量是均量的 ${volRatio} 倍

最近12根5分钟K：
${recentBars}

请按以下格式输出：

**📊 今日分时判断**
[一句话：今日节奏（震荡/单边/V形），当前处于什么位置]

${
    hasPosition
        ? `**🔄 持仓做T（高抛低吸，降成本）**
步骤1 卖出：[条件+价格，如"分时走弱跌破 XX 元卖出 XX 股（半仓）"]
步骤2 等待：[等什么信号再买回，如"等回踩 XX 元企稳"]
步骤3 买回：[具体价格+条件]
- 做T成功条件：卖出价 - 买回价 > 0.5%
- 做T放弃条件：[什么情况下不做T，持仓不动]`
        : `**📈 空仓做T（来回波段）**
步骤1 买入：[条件+具体价格，如"5min MACD金叉 + 价格站上 XX 元，买入 XX 股"]
步骤2 止损：[具体价格，亏X%出]
步骤3 止盈：[具体价格，赚X%出]
步骤4 二次机会：[回踩再买的条件]`
}

**⚠️ 关键价位**
- 上方阻力：[价格]
- 下方支撑：[价格]
- 不操作条件：[今天什么情况不适合做T]`,
        },
    ]
}
