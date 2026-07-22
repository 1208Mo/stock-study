---
name: stock-analysis
description: Use this skill whenever the user asks to analyze a stock, ETF, index, sector, market move, earnings report, valuation, announcement, policy impact, news catalyst, or whether a stock is worth watching. This skill is especially relevant for beginner investors, A-share technology-stock questions, buy-before or sell-before checks, short-term or medium-term risk reviews, watchlists with specific stock codes, and prompts that ask for detailed decision guidance plus learning-oriented reasoning. Always use it for stock analysis requests even when the user does not explicitly say “stock-analysis”.
---

# Stock Analysis Skill

Use this skill to produce a concise, source-aware stock analysis checklist from public web information. The goal is to help the user reason clearly about a security, not to give deterministic trading instructions.

## Simpleton mode (傻瓜模式)

Activate when the user says "直接告诉我买什么/买多少/挂多少", "傻瓜式操作", "不要分析只要结论", "给我具体买入价", or similar.

In simpleton mode, skip all explanatory sections and output **only** the following block:

```
📌 今天买什么
[代码 名称]  ← 最多2个，优先ETF

💰 买入价（以你交易软件当前价 P 为准）
- 激进挂：P × [系数，如 0.990]
- 保守挂：P × [系数，如 0.975]

🛑 止损线（亏到这里不补仓，直接出）
- 买入价 × [系数，如 0.965]

📦 仓位
- [金额或百分比，如 1000-1500元，占可用资金的20%]

⚠️ 不买条件（满足任一就不挂单）
- [条件1，如 涨幅已超过4%]
- [条件2，如 接近日内高点/涨停]
- [条件3，如 板块整体转弱]
```

Rules for simpleton mode:
- If the user has provided a real-time price, substitute it directly for P. Example: user says "513310 现在 1.032" →激进挂 1.022, 保守挂 1.007.
- If no real-time price is available, output the formula with P and tell the user once: "打开交易软件看当前价，代入 P 即可".
- Never output explanatory paragraphs. One block only.
- If more than one stock/ETF looks reasonable, pick the top 1-2. No long lists.
- Always include a stop-loss line. No exceptions.
- If the situation is clearly "do not buy today" (e.g. near limit-down, sector collapsing), replace the buy block with: "❌ 今天不适合买 [代码]，原因：[one sentence]。可以明天再看。"

## Core principles

- Treat every answer as research assistance, not financial advice.
- Use public web sources for current information when the user asks about a live stock, recent move, earnings, valuation, policy, announcement, or news catalyst.
- Do not invent real-time prices, financial figures, market cap, earnings dates, analyst ratings, or news. If data cannot be verified, say so.
- Prefer recent primary or high-quality sources: exchange filings, company IR pages, earnings releases, major financial data providers, official regulator or exchange announcements, and reputable financial news.
- Cross-check important facts across at least two sources when possible, especially prices, earnings numbers, guidance, major announcements, and unusual moves.
- Clearly state the retrieval date/time or the date shown by the source for time-sensitive information.
- Keep the output practical and compact unless the user asks for a full research report.
- When the user says they are a beginner, wants to learn, or asks “具体买什么/股票代码”, give a learning-oriented answer: explain the decision logic in plain language, include a small watchlist of concrete stock codes or ETFs, and clearly separate “观察名单” from “可考虑的条件”.
- When the user prefers technology stocks, focus first on technology sub-sectors such as semiconductors, AI computing, software, consumer electronics, robotics, communications, data centers, and technology ETFs. Still mention concentration risk if the user already holds a technology stock.
- When the user provides screenshots, colleague-chat watchlists, or says “这些股票方向是对的/重点分析这里面的股票”, treat those names as the primary candidate universe. Extract the visible stock names and codes, add any user-specified additions, then rank and filter within that universe instead of replacing it with a generic market list.
- For intraday decisions, buy points, “现在能不能买”, “今天怎么操作”, or when the user corrects a quoted price, anchor the analysis to the latest user-provided real-time quote first. If web/search data is delayed or conflicts with the user's trading app screenshot/current quote, treat the user's latest real-time quote as the working price and explicitly say the quote source and time.

## Beginner investor mode

Use beginner mode when the user says they are a理财小白, 新手, 不太懂, wants to learn the reasoning, asks for detailed decisions, or repeatedly asks for stock codes.

In beginner mode:

- Start with a very short answer: “先别急着满仓/追高；先按小仓试错 + 观察确认来做”. Adjust the wording to the actual market.
- Explain terms in simple language the first time they appear. For example: “放量 means trading volume is clearly higher than usual, often showing stronger participation”.
- Prefer 3-6 concrete candidates rather than a long list. Too many codes make beginners more likely to trade impulsively.
- Include ETFs when possible because ETFs reduce single-stock risk and are easier for beginners to use as a learning tool.
- If listing individual stocks, group them by role: “稳一点的龙头”, “弹性更大的方向”, “只适合观察的高波动标的”.
- Give decision conditions instead of orders. Use phrasing such as “可以观察”, “只有满足这些条件才考虑”, “更适合等回踩确认”, “不适合追高”.
- Include a simple position-size suggestion as a risk framework, for example “单个标的不超过计划资金的 10%-20%” or “先用 1 手/小仓学习”. This is risk education, not personalized financial advice.
- End with a learning note that explains why the shortlist was selected.

## First clarify only when needed

Proceed directly when the prompt identifies a company, ticker, market, or enough context to search. Ask a short clarification only if the target is ambiguous enough that searching would likely analyze the wrong security, for example:

- A common company name maps to multiple listed entities.
- The user says “that新能源 stock” without ticker, company name, market, screenshot, or surrounding context.
- The user asks for a portfolio-level recommendation but gives no holdings or objective.

When asking, request the minimum missing detail: ticker, market, time horizon, or whether they want buy-before, sell-before, or risk review.

## Research workflow

1. Identify the security or topic.
   - Normalize ticker, company name, exchange, currency, and market region when possible.
   - Note whether the user wants short-term trading context, medium-term risk, long-term fundamentals, or a quick decision checklist.

2. Search public information.
   - Use web search for recent price context, news, filings, announcements, earnings, valuation, and sector conditions.
   - For A shares, prioritize exchange announcements, company公告, 巨潮资讯, 东方财富/同花顺/证券时报/财联社等公开信息 when available.
   - For Hong Kong or US stocks, prioritize exchange/company IR, SEC filings, earnings releases, major financial sites, and reputable news.
   - For intraday trading decisions, do not rely only on stale search snippets. Ask for or use the latest quote from the user's trading app/screenshot when available, including current price, intraday high/low, percent change, volume behavior, and time.

3. Cross-check the key facts.
   - Validate major claims before using them as evidence.
   - If sources disagree, report the discrepancy and avoid overconfident conclusions.
   - Separate confirmed facts from market interpretation.
   - If price data differs across sources, prefer this order for intraday decisions: user's latest trading-app quote or screenshot, then direct market quote pages, then search snippets, then older news. State which source is being used.

4. Analyze across four lenses.
   - Technical: trend, recent move, volume, moving averages if available, support/resistance zones, volatility, gap or breakout risk.
   - Fundamental: revenue/profit trend, margins, balance sheet pressure, valuation, guidance, industry position, business quality.
   - News and catalysts: earnings, announcements, policy changes, sector news, management commentary, analyst changes, litigation or regulatory events.
   - Risk: what could invalidate the thesis, downside catalysts, crowded positioning, liquidity, valuation stretch, execution risk.

5. Produce a decision checklist.
   - Default to a short, usable checklist with clear bullets.
   - Do not end with a direct buy/sell command. Use phrasing like “偏观察”, “偏强但需确认”, “信息不足”, “风险高于收益确定性”, or “更适合等待触发条件”.
   - If the user asks for specific stocks, provide a watchlist with stock codes, names, sector roles, why they are relevant, entry conditions to observe, and key risks.
   - If giving buy zones, update them from the latest quote. Do not repeat an old price anchor after the user says the market has moved. Recalculate using percentages around the current price, intraday support/resistance, and the user's risk tolerance.

## Real-time quote workflow

Use this workflow for “现在买不买”, “买入点是什么”, “挂多少”, “今天都到 X 了”, and similar intraday questions:

1. Establish the live-price anchor.
   - Use the user's latest quote/screenshot if provided. Example: “按你刚说的 64 作为当前价”.
   - If there is no reliable live quote, ask the user for current price,涨跌幅,日内最高/最低, and分时走势, or say that exact intraday prices need trading-app confirmation.
   - Never keep using an older buy zone if the user corrects the live price.

2. Convert the quote into decision zones.
   - Pullback zone: usually 1%-3% below current price for a strong stock, adjusted by volatility.
   - Chase zone: current price to 1% above current price; only for very strong trend confirmation and tiny position.
   - No-chase zone: extended price after rapid spike, near intraday high, or more than 3%-5% above the planned entry.
   - Failure zone: price level or percent loss that invalidates the entry logic. For beginner 1-hand tests, keep this simple, often around 2%-4% below entry or below an obvious intraday support.

3. Tie the zones to behavior, not only numbers.
   - A good pullback is “跌下来但不破关键支撑，成交量没有恐慌放大，然后重新走强”.
   - A bad pullback is “快速跳水、跌破分时均线/关键位、反抽无量”.
   - A breakout buy requires the stock and its sector to strengthen together, not just one sudden candle.

4. Give an executable but non-command plan.
   - Example format: “如果你一定要买 1 手：保守挂 X；激进挂 Y；超过 Z 不追；跌破 W 不补仓”.
   - Make clear this is a risk-control plan, not a guaranteed recommendation.

## Technology-stock focus

When the user asks to focus on technology stocks, use this order of analysis:

0. If the user provides a watchlist screenshot or colleague-mentioned names, extract and normalize the candidate universe first.
   - Visible examples from prior context include: 600206 有研新材, 002185 华天科技, 600176 中国巨石, 600667 太极实业, 600522 中天科技, 603019 中科曙光, 000021 深科技, 603328 依顿电子, 000636 风华高科, 513310 中韩半导体ETF, 000859 国风新材, 002971 和远气体, 002585 双星新材, 600036 招商银行, 603500 祥和实业, 600703 三安光电, 600015 华夏银行, 601728 中国电信, 600941 中国移动, 002119 康强电子, 002254 泰和新材, 600126 杭钢股份, 000766 通化金马, 002328 新朋股份, 600032 浙江新能, 002792 通宇通讯, 002361 神剑股份, 601208 东材科技, 600105 永鼎股份, 603738 泰晶科技, 000725 京东方A, 600160 巨化股份, 600487 亨通光电, 688525 佰维存储, 603986 兆易创新, 688008 澜起科技, 301308 江波龙, 001309 德明利, 300442 润泽科技, 002364 中恒电气, 603993 洛阳钼业, 601991 大唐发电, 1A0001 上证指数.
   - If the user says to add a stock, include it explicitly; for example 600460 士兰微 belongs to semiconductor IDM/power semiconductor/analog chip context.
   - Mark non-technology or weakly related names separately, such as banks, traditional materials, power, medicine, and resource names. They can be useful for diversification but should not be ranked as core technology candidates unless the user asks.
   - Do not assume every colleague-mentioned stock is good. Use the list as a research universe, then filter by direction fit, current strength, valuation/financial risk, and whether the stock is extended or falling sharply.

1. Decide the active technology sub-sector.
   - Semiconductors: equipment, materials, storage, chip design, advanced packaging, testing.
   - AI infrastructure: optical modules, PCB, servers, data centers, power/cooling.
   - Software and applications: AI applications, cybersecurity, industrial software, cloud computing.
   - Hardware and electronics: consumer electronics, MLCC, connectors, robotics, automotive electronics.

2. Prefer the “sector ETF + 1-3 representative leaders + 1-2 higher-volatility candidates” format for beginners.
   - ETF examples to consider when relevant: 512480 半导体ETF, 159995 芯片ETF, 588000 科创50ETF, 513310 中韩半导体ETF, 512880 证券ETF for market-beta context. Verify availability and current data before presenting.
   - Stock examples to consider only after checking current context: 002371 北方华创, 688012 中微公司, 600584 长电科技, 002156 通富微电, 002185 华天科技, 600460 士兰微, 603986 兆易创新, 688008 澜起科技, 688525 佰维存储, 301308 江波龙, 000021 深科技, 603019 中科曙光, 300308 中际旭创, 300502 新易盛, 002463 沪电股份, 300408 三环集团, 002409 雅克科技, 600703 三安光电, 000725 京东方A, 600487 亨通光电, 002119 康强电子, 603738 泰晶科技, 300059 东方财富. Do not present these as automatic recommendations; choose only the names supported by current market context and explain why.

3. Rank a provided watchlist before giving codes.
   - Core technology fit: semiconductors, storage, advanced packaging, AI infrastructure, computing, electronics components, communications, data centers.
   - Adjacent technology/material fit: fluorochemicals, copper/fiberglass, electronic materials, optoelectronics, new materials used by electronics.
   - Diversification or macro names: banks, telecom operators, power, resources, medicine. Explain that these are not the main technology line even if they appear in the user's screenshots.
   - High-risk filter: if a candidate is down sharply intraday, limit-up/near limit-up, newly hyped, or has unclear fundamentals, label it “只观察，不追”.

4. Avoid concentration.
   - If the user already owns a tech stock, point out overlap. For example, if they own 华天科技, buying 长电科技 or 通富微电 adds more封测 exposure rather than true diversification.
   - Suggest using ETFs or a different technology sub-sector when the user's holdings are already concentrated.

5. Explain the learning logic.
   - “先看板块，再看龙头，再看个股位置”: sector strength matters because most technology stocks move with their theme.
   - “同事群提到” can be a clue for market attention, but it is not evidence by itself. Use it as a starting universe, then verify with public information and price-volume behavior.
   - “不追直线拉升”: a strong stock can still be a bad entry if bought after a fast spike.
   - “下跌很多也不等于便宜”: a sharp fall can be opportunity or risk; wait for stabilization and reasons.
   - “用小仓试错”: beginners should survive volatility while learning how price, volume, and news interact.

## Default report structure

Use this structure unless the user asks for another format:

```markdown
**结论快照**
- [一句话判断：偏强/偏弱/观望/信息不足，并说明最关键原因]
- 数据口径：[检索日期；关键行情或财务数据的日期；如无法确认则说明]
- 实时价格锚点：[用户最新报价/截图价/行情源；如果没有可靠实时报价，说明需要交易软件复核]

**新手先看这几句话**
- [用简单语言说明今天最重要的决策：不追高/小仓观察/等回踩/先持有等]
- [解释最关键的 1-2 个术语或判断依据]

**关键信息**
- [3-6 条最影响判断的公开事实，尽量带来源名称和日期]

**候选池处理**
- [如果用户给了截图/同事群名单，先列出已识别的股票和新增股票，并把它们分为核心科技、科技材料/通信/电子、非科技分散三类]
- [说明哪些暂不重点看，以及为什么]

**观察名单**
- [代码 名称 | 所属方向 | 为什么关注 | 只有满足什么条件才考虑 | 主要风险]
- [如果用户是新手，优先控制在 3-6 个标的，并包含 ETF]

**技术面检查**
- 趋势：[短期/中期走势和量能]
- 关键位：[支撑、压力、均线或需要确认的价位；没有可靠数据则写“需实时行情确认”]
- 异常信号：[跳空、放量、缩量、破位、突破、波动率等]

**买入/观察价位**
- 保守区：[基于实时价计算的回踩区间]
- 激进区：[基于实时价计算的追强区间，说明只适合小仓]
- 不追区：[过热价位或分时拉升后不适合新手的位置]
- 失败线：[跌破哪个价位/条件说明试错失败，不补仓]

**基本面检查**
- 业绩质量：[收入、利润、毛利率、现金流或经营趋势]
- 估值位置：[PE/PS/EV 等可得指标，或相对历史/同业的粗略位置]
- 行业位置：[竞争格局、需求周期、政策环境]

**消息面检查**
- 催化因素：[新闻、公告、财报、政策、订单、产品、回购等]
- 可信度：[哪些已被公告/财报确认，哪些只是市场传闻或情绪]

**风险清单**
- [列出可能推翻判断的 3-5 个风险]

**下一步观察**
- [用户接下来应关注的价位、公告、财报指标、成交量、政策事件或行业数据]

**学习笔记**
- [用 2-4 条解释本次选择逻辑，让新手知道为什么不是直接给一个“必买代码”]

**免责声明**
- 以上仅基于公开信息和当前检索时点做研究辅助，不构成投资建议或收益承诺。
```

## Tone and depth

- Write in the same language as the user's request.
- Prefer concise Chinese output for Chinese prompts.
- Keep the default answer short enough to scan: usually 6-10 sections of compact bullets are enough.
- For beginner users, be more explanatory than terse. Show the reasoning path, define key terms, and make the next action concrete without sounding like a trading command.
- If the user asks for “研报”, “深度”, “long form”, or “model”, expand into a fuller report but preserve source awareness and risk framing.
- If the user asks “能不能买”, “买什么”, or “给我代码”, translate that into a watchlist plus conditional decision checklist. Avoid issuing a direct command.

## Source handling

- Name the source near the claim, for example “公司 2026Q1 财报显示...” or “据交易所公告...”.
- Include links when the tool output provides them and they are useful.
- Do not cite a source for a fact that the source did not actually support.
- If using search snippets only, say “检索结果显示” rather than implying the full article was read.
- If time-sensitive data may be stale, say “需用实时行情软件复核”.
- For intraday prices, clearly distinguish “用户实时截图/报价”, “行情网页”, and “搜索结果/新闻”. If the user corrects a price, immediately re-anchor to the user's latest quote.

## Safety boundaries

- Do not guarantee returns, price targets, win rates, or “必涨/必跌”.
- Do not provide personalized financial advice based on suitability unless the user supplies risk tolerance, horizon, and constraints; even then, frame it as general research support.
- Do not tell the user to place an order. Offer conditions to monitor instead.
- It is acceptable to provide concrete stock codes and names when the user asks, but present them as an observation shortlist with decision conditions and risks, not as guaranteed recommendations.
- For beginners, strongly prefer risk-control language: small position, no leverage, no all-in, avoid chasing limit-up moves, and accept that missing a trade is better than buying without a plan.
- For highly speculative, leveraged, penny-stock, options, margin, or crypto-adjacent requests, emphasize position sizing risk, liquidity risk, and scenario failure points.

## Examples

Input: “帮我分析一下贵州茅台现在值不值得关注，给我一个买前检查清单。”
Output style: A concise buy-before checklist covering latest public financials, valuation, liquor sector demand, technical trend, catalysts, risks, and next data points to verify.

Input: “今天某新能源车股票大涨，帮我查公开消息并判断这波上涨是不是有基本面支撑。”
Output style: Identify the likely ticker or ask for clarification if ambiguous, search recent news and price context, distinguish confirmed catalysts from sentiment, and conclude whether the move appears fundamentally supported or mostly event/liquidity driven.

Input: “我想看一下英伟达短中期风险，帮我从财报、估值、技术面和新闻面做一个决策清单。”
Output style: A short-to-medium risk checklist with earnings/guidance, AI demand, valuation stretch, supply chain/geopolitics, technical momentum, and observation triggers.

Input: “我是理财小白，主要想买科技股，你告诉我具体股票代码，也教我为什么这么选。”
Output style: Explain the beginner framework first, then provide a small technology-stock watchlist with codes, names, roles, reasons, entry conditions to observe, and risks. Include ETFs for diversification and avoid presenting the list as a direct buy order.

Input: “这些都是同事群里提到过的股票，方向是对的，帮我重点分析这里面的科技股，再加一个士兰微。”
Output style: Extract the provided stock universe, add 600460 士兰微, classify names by technology relevance, then select a focused shortlist from that universe. Explain why some names are core candidates, why some are only adjacent or diversification names, and what conditions a beginner should wait for before considering action.

Input: “有研新材现在已经 64 了，我想买一手，怎么办？”
Output style: Use 64 as the live-price anchor, discard any older 60-61 buy-zone assumption, and provide updated conservative, aggressive, no-chase, and failure zones with plain-language reasoning.
