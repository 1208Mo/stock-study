1. 工具调用 Agent：最值得先做
现在 AI 多数是“你把数据喂给它，它生成回答”。下一步可以让 AI 自己决定要调用什么工具。
比如用户在 AI 对话页问：
中国平安现在还能买吗？
Agent 应该自己判断需要：
查实时行情
查日 K / 周 K
查板块信息
查分红记录
查相关新闻
最后再综合回答
你可以把现有 fetchQuote、fetchKlines、fetchSectorInfo、fetchDividends 包成 LangChain Tools。
能学到：
Tool Calling
工具 schema 设计
Agent 如何选择工具
工具结果如何注入上下文
如何限制 AI 不胡说
这是你项目里最自然的 Agent 练习点。
2. 把每日决策 LangGraph 变复杂一点
你现在的每日决策流程大概是：

text

插入
复制
fetchNews -> analyzeMarket -> fetchQuotes -> makeDecision
可以升级成：

text

插入
复制
fetchNews
  -> analyzeMarket
  -> discoverCandidates
  -> fetchQuotes
  -> technicalFilter
  -> riskCheck
  -> makeDecision
  -> validateDecision
其中：
discoverCandidates：从热点板块里自动找候选股
technicalFilter：用规则过滤涨太高、成交量异常、跌破均线的票
riskCheck：检查是否超过单票 20% 仓位、是否创业板/科创板、是否止损过远
validateDecision：让另一个节点检查最终建议有没有违反规则
能学到：
LangGraph 状态建模
条件边
多节点协作
agentic workflow
自我校验
这比直接搞“多 Agent 辩论”更有价值。
3. 长期记忆：让 AI 记住你的投资偏好
现在 chat.ts 的记忆主要是前端传历史消息，本质是短期上下文。你可以做一个真正的“用户画像记忆”。
比如记录：
你的可用资金
风险偏好
偏好的股票类型：ETF、主板蓝筹、科技、红利等
不碰的类型：创业板、科创板、ST、北交所
最近关注过哪些股票
哪些建议你采纳了，哪些你否决了
可以先不用向量库，直接存在 SQLite 里就够了。
能学到：
short-term memory vs long-term memory
memory summary
preference extraction
retrieval before generation
这个功能对你的项目很实用，因为投资建议必须结合用户约束。
4. 复盘 Agent：让 AI 学会检查自己之前说得准不准
这是股票项目特别适合练的点。
你可以把每日 AI 决策存下来，然后第二天或一周后自动复盘：
昨天推荐了什么
当时理由是什么
今天实际涨跌如何
买入价、止损价、止盈价有没有触发
哪条判断对了，哪条判断错了
下次规则要怎么调整
能学到：
feedback loop
evaluator agent
prediction tracking
自动评估
prompt / 规则迭代
这比单纯“让 AI 分析股票”更像真正的 Agent 系统，因为它有闭环。
5. Human-in-the-loop：关键操作让用户确认
可以让 Agent 做建议，但涉及写入数据时必须让你确认。
例如：
Agent 建议把某股票加入观察列表
Agent 建议设置价格提醒
Agent 建议调整持仓备注
Agent 建议今天观望并给理由
流程是：

text

插入
复制
Agent 生成计划 -> 用户确认 -> 执行写入
能学到：
human-in-the-loop
approval gate
LangGraph interrupt / checkpoint 思想
安全边界设计
这对投资类应用很重要，因为 AI 不应该直接替用户下决策。
6. 结构化输出和校验
现在很多 AI 输出是 Markdown。阅读舒服，但程序很难可靠解析。
可以把关键 Agent 输出改成 JSON，例如：

ts

插入
复制
{
  action: "watch" | "buy_zone" | "avoid",
  priority: 1,
  code: "510300",
  name: "沪深300ETF",
  entryPrice: 3.91,
  stopLoss: 3.78,
  takeProfit: 4.06,
  confidence: 0.72,
  reasons: []
}
再用 zod 校验。
能学到：
structured output
output parser
schema validation
guardrails
LLM 输出稳定性治理
你的项目已经装了 zod，很适合做这个。
7. 新闻 / 研报 RAG：让回答有证据
现在 AI 分析可能会凭模型常识回答。你可以做一个“带来源的市场信息 Agent”。
流程：

text

插入
复制
抓新闻 -> 清洗 -> 按股票/板块归档 -> 查询相关信息 -> 回答时引用依据
回答时强制输出：
依据 1：来自哪条新闻
依据 2：来自哪项行情数据
不确定信息：明确标注
能学到：
RAG
grounding
citation
减少幻觉
上下文压缩
在股票场景里，这个比普通聊天更重要。
8. 识图导入：多模态 Agent
你需求文档里已经提到“观察列表和持仓列表建议添加识图导入”。这个可以做成多模态 Agent：
上传截图
OCR / 视觉模型识别股票代码、名称、数量、成本价
Agent 判断字段是否完整
缺失字段让用户补充
用户确认后导入 SQLite
能学到：
multimodal agent
extraction
confidence score
人工确认
数据清洗
这是很好的实践题，而且和你的真实痛点直接相关。
9. 主动型 Agent：定时提醒和盘中异动
你已经有 scheduler.ts。可以把它升级成主动 Agent：
盘前自动生成今日计划
盘中检测观察列表异动
跌破止损提醒
接近买入区提醒
收盘后复盘
能学到：
event-driven agent
scheduled agent
trigger-condition-action
alert reasoning
这会让项目从“用户问 AI”变成“AI 主动帮你盯”。