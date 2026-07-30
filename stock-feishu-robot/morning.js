/**
 * 早报 — 每天 08:30 左右运行
 * 功能：拉取隔夜消息 + 今日重要公告，AI 研判开盘方向
 *
 * 运行方式：node feishu/morning.js
 * 定时任务示例（crontab）：0 9 * * 1-5  cd /path/to/stock-study && node feishu/morning.js
 */

const { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, fetchSectorRanking, fetchConceptRanking, callAI, sendFeishuCard, getFetchErrors } = require("./common");

async function main() {
    console.log("[早报] 拉取数据...");
    const [news, ann, globalIndices, sector, concept] = await Promise.all([
        fetchSinaNews(20),
        fetchEastMoneyAnn(15),
        fetchGlobalIndices(),
        fetchSectorRanking(),
        fetchConceptRanking(10)
    ]);
    console.log(`快讯 ${news.length} 条，公告 ${ann.length} 条，AI 分析中...`);

    const newsText = news.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const annText = ann.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const sectorBlock = sector
        ? `## 昨日行业板块表现（收盘快照）
### 涨幅榜 Top8
${sector.top}

### 跌幅榜 Top5
${sector.bottom}

### 主力资金净流入榜 Top5（真金白银流向）
${sector.inflow}

### 主力资金净流出榜 Top5（被抛售的方向）
${sector.outflow}`
        : "## 行业板块数据\n（本次获取失败，无法参考）";
    const conceptBlock = concept
        ? `## 昨日概念板块涨幅榜 Top10（新主题冒头的地方）\n${concept}`
        : "";

    const prompt = `你是一名擅长"看资金、不看标题"的资深A股分析师。新闻和公告是表面信息，真正赚钱的方向往往藏在资金流向、板块联动和量价背离里。请基于以下多维度数据给出开盘前研判。

## 全球主要指数行情（实时）
${globalIndices}

${sectorBlock}

${conceptBlock}

## 财经快讯（${news.length}条）
${newsText}

## 上市公司公告（${ann.length}条）
${annText}

分析要求（重要）：
1. 优先看资金流向而非涨跌幅：主力大幅净流入但涨幅不大的板块 → 有资金潜伏；涨幅大但主力净流出 → 高位派发，谨慎追高。
2. 结合概念板块看主题冒头，行业板块看主线延续。
3. 新闻只是佐证，不要被"热门标题"带偏——如果新闻热闹但资金没跟，说明是纸面利好。
4. 明确指出"暗流"：昨日资金悄悄流入、但市场关注度低的方向。

请严格按以下格式输出，不要多余内容：

【全球指数早读】
2-3句话说明外盘对A股开盘的传导影响。

【昨日资金主线】
2-3句话总结：主力资金的真实动向是什么？是抱团流入哪几个方向，又在哪些方向撤退？

【暗流涌动 · 值得埋伏的方向】
从"主力净流入 + 涨幅不大 + 关注度低"三个条件筛选出 1-2 个方向，说明潜伏逻辑。这是本报的核心。

【开盘研判】
3-4句话：今日A股开盘方向（高开/低开/平开），核心驱动因素，主要风险点。

【热点板块】
2-3个今日值得关注的板块，格式：板块名 — 逻辑一句话（说明是"资金驱动"还是"消息驱动"）

【重点个股信号】
从公告和快讯中筛选3-5条今日有明确利好或利空信号的个股，格式：
**公司名（代码）** 📈/📉 — 原因一句话

【操作建议】
2-3条简短提示：今日重点关注什么，回避什么。`;

    const aiText = await callAI(prompt);
    console.log("AI 输出：\n", aiText);

    const errors = getFetchErrors();
    const errorNotice = errors.length ? `\n\n---\n**数据源异常提示**\n${errors.join("\n")}` : "";

    await sendFeishuCard({
        title: "🌅 A股早报 · 开盘研判",
        template: "green",
        content: aiText + errorNotice
    });
}

main().catch(err => {
    console.error("[早报] 运行失败：", err.message);
    process.exit(1);
});
