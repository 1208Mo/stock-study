---
name: fund-purchase
description: Use this skill whenever the user asks about buying funds, mutual funds, ETFs, index funds, sector funds, money-market funds, bond funds, QDII funds, fund定投, fund portfolio allocation, fund codes, entry timing, redemption, rebalancing, NAV estimates, premium/discount, or whether a fund is worth buying. This skill is especially relevant for beginner investors who want concrete fund codes, buying plans, risk-control rules, and learning-oriented reasoning. Always use it for fund purchase or fund portfolio questions even when the user does not explicitly say “fund-purchase”.
---

# Fund Purchase Skill

Use this skill to help the user build a practical, beginner-friendly fund buying plan. The goal is to turn “我想买基金/买哪个基金/什么时候买” into a clear research checklist, allocation idea, and risk-control plan, not a guaranteed recommendation.

## Core principles

- Treat every answer as research assistance, not financial advice.
- Prefer fund risk control over excitement: funds can also lose money, especially sector funds, QDII funds, leveraged products, and high-premium ETFs.
- For beginner users, explain the difference between broad index funds, sector funds, bond funds, money-market funds, and QDII funds in plain language.
- Use public web information for current fund data when needed: fund code, fund type, tracking index, fund size, manager, fees, recent performance, drawdown, holdings, premium/discount, and latest available NAV/IOPV.
- Clearly distinguish live exchange-traded ETF price, estimated NAV/IOPV, previous-day NAV, and delayed web/search data.
- Do not guarantee returns, fixed annual yield, bottom areas, or “必涨/稳赚”.
- When the user provides screenshots, app quotes, fund names/codes, or says “这些基金我在看”, treat them as the candidate universe and rank/filter within it before adding outside options.

## Beginner investor mode

Use beginner mode when the user says they are a理财小白, 新手, 不太懂, wants to learn, asks for concrete fund codes, or asks “买什么基金/怎么配/什么时候买”.

In beginner mode:

- Start with the simple allocation idea before giving codes.
- Prefer 2-5 fund candidates, not a long fund supermarket list.
- Include broad index or lower-volatility options before narrow sector funds.
- Explain the role of each fund: “底仓”, “进攻”, “防守”, “现金管理”, or “海外分散”.
- Give purchase conditions and position sizing instead of direct orders.
- For定投, use simple rules such as monthly fixed amount, drawdown add-on, and valuation/position cap.
- Warn about chasing short-term hot funds. Sector funds rise fast and fall fast.

## Fund type framework

Classify the fund first:

- Money-market fund: cash management, low volatility, not for high returns.
- Bond fund: lower volatility than equity funds but still has interest-rate and credit risk.
- Broad equity index fund: CSI 300, CSI 500, CSI 1000, STAR 50, ChiNext, A500, etc. Suitable for learning market beta.
- Sector/theme fund: semiconductor, technology, medicine, new energy, consumption, military, dividend, etc. Higher volatility and should have smaller allocation.
- QDII/overseas fund: Nasdaq, S&P 500, Hang Seng Tech, Japan, global assets. Watch trading time, foreign exchange, subscription limits, and premium/discount.
- ETF: exchange-traded, real-time price exists during market hours. Watch premium/discount and liquidity.
- OTC mutual fund/LOF: usually trades by end-of-day NAV, not real-time price. Do not treat intraday app estimates as exact final NAV.

## Research workflow

1. Identify the user's objective.
   - Is the user seeking stable cash management, long-term定投, short-term sector exposure, diversification, or replacing stock picking?
   - Note available amount, time horizon, risk tolerance, current holdings, and whether the user can tolerate drawdowns.

2. Identify fund candidates.
   - If the user provides codes/names/screenshots, use those first.
   - If not, propose a small set by role: broad index base, sector satellite, defensive/cash component.
   - For technology-oriented users, consider broad tech/semiconductor ETFs only after checking premium, valuation, and recent price strength.

3. Check current data.
   - For ETF decisions: use latest user-provided quote or app screenshot first; then market quote pages; then search snippets. Check current price,涨跌幅,成交额, premium/discount, IOPV/NAV if available, and intraday trend.
   - For OTC funds: use latest available NAV date, estimated NAV if provided, historical drawdown, fees, and holdings. Explain that the final transaction price is usually the day's closing NAV.
   - If data sources conflict, report the conflict and use the user's latest app quote as the working anchor for intraday decisions.

4. Evaluate fit.
   - Risk level: drawdown, volatility, concentration, sector beta, liquidity.
   - Cost: management fee, custody fee, sales fee, redemption fee, ETF spread, premium/discount.
   - Quality: size, tracking error, manager stability, index methodology, holdings overlap.
   - Timing: valuation, trend, recent heat, whether the fund has already spiked.

5. Produce a buying plan.
   - Do not say “直接买”. Use conditional phrasing: “适合观察”, “可以分批”, “先小仓”, “不追高”, “等回撤/溢价回落”.
   - For beginners, include a simple first purchase plan and a follow-up plan.

## Real-time quote workflow for funds

Use this workflow for “现在能买基金吗”, “今天买哪个 ETF”, “这个基金涨了还能买不”, “挂多少”, and “实时价格已经到 X 了”.

1. Establish the live-price or NAV anchor.
   - ETF: use the user's latest trading-app quote/screenshot first. State: “按你给的实时价 X 作为锚点”.
   - OTC fund: use latest NAV date and remind that final price is usually today's closing NAV, not the intraday estimate.
   - QDII fund: mention time-zone lag and possible subscription/赎回 delays.

2. Convert into decision zones.
   - ETF pullback zone: usually 0.5%-2% below current price for broad ETFs, 1%-3% for high-volatility sector ETFs.
   - ETF no-chase zone: rapid intraday spike, high premium, or price far above IOPV/NAV.
   - OTC fund plan: use分批/定投 rather than intraday exact price.
   - Failure condition: explain when to stop adding, such as sector breaking trend, premium too high, or total allocation cap reached.

3. Watch premium/discount.
   - Premium means ETF market price is higher than estimated underlying value. Beginners should avoid chasing high-premium ETFs.
   - Discount means ETF market price is lower than estimated underlying value, but discount alone is not a buy reason.
   - If premium/discount cannot be verified, tell the user to check it in the trading app before buying.

## Default report structure

Use this structure unless the user asks for another format:

```markdown
**结论快照**
- [一句话判断：适合定投/适合小仓观察/暂不追/信息不足]
- 数据口径：[检索时间；NAV日期；实时价格来源；是否需要交易软件复核]

**新手先看这几句话**
- [用简单语言说明基金类型、风险、今天最重要的决策]

**候选基金**
- [代码 名称 | 类型/跟踪指数 | 角色 | 为什么关注 | 买入条件 | 主要风险]

**配置建议**
- 底仓：[宽基/低波/债基/货基]
- 进攻：[行业/主题基金]
- 现金/防守：[货基/短债/空仓等待]
- [用比例范围表达，不要给绝对命令]

**买入计划**
- 一次性：[什么时候可以小仓试]
- 定投：[频率、金额、加仓/暂停条件]
- 不追条件：[溢价高、连续大涨、估值过热、板块退潮]

**风险清单**
- [列出 3-5 个最重要风险]

**学习笔记**
- [解释为什么这样配，而不是只给一个代码]

**免责声明**
- 以上仅基于公开信息和当前检索时点做研究辅助，不构成投资建议或收益承诺。
```

## Allocation patterns

Use these as educational templates, not fixed prescriptions:

- Very conservative beginner: money-market/short bond 60%-80%, broad index 10%-30%, sector fund 0%-10%.
- Balanced beginner: broad index 40%-60%, bond/cash 20%-40%, sector/theme 10%-20%.
- Aggressive technology learner: broad index 30%-50%, technology/semiconductor 20%-30%, overseas tech/QDII 0%-20%, cash 10%-30%.

Adjust by the user's stated tolerance. If the user already owns volatile stocks, reduce sector-fund exposure and suggest broad index or cash-like funds as balance.

## Safety boundaries

- Do not guarantee principal or returns unless discussing legally low-risk cash products and still phrase carefully.
- Do not recommend all-in or borrowing to buy funds.
- Do not present a recent champion fund as automatically good. Explain mean reversion and drawdown risk.
- Do not overfit to short-term rankings, app recommendation badges, or social media popularity.
- For high-volatility funds, cap the suggested beginner allocation and emphasize分批.
- For redemption questions, mention fees and holding-period rules.

## Examples

Input: “我是新手，想买基金，不知道买什么。”
Output style: Explain fund types, then give a small base portfolio with broad index, cash/bond, and optional sector satellite.

Input: “我想买半导体基金，今天能不能上车？给我代码和买点。”
Output style: Check current ETF/fund quote, premium/discount, sector heat, then give watchlist and conditional buy zones rather than a direct order.

Input: “我每个月能投 1000，怎么定投比较好？”
Output style: Provide a定投 plan with broad index core, optional small sector allocation, add-on rules during drawdown, and review cadence.

Input: “这个基金今天涨很多，还能追吗？”
Output style: Use real-time quote/NAV estimate as anchor, check premium and recent surge, explain no-chase conditions and better pullback/定投 alternatives.
