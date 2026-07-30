/**
 * 晚报 — 每天 16:30 左右运行（收盘后）
 * 功能：拉取当日盘后消息 + 公告，AI 复盘今日行情并展望明日
 *
 * 运行方式：node feishu/evening.js
 * 定时任务示例（crontab）：30 16 * * 1-5  cd /path/to/stock-study && node feishu/evening.js
 */

const { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, fetchSectorRanking, fetchConceptRanking, callAI, sendFeishuCard, getFetchErrors } = require("./common");

async function main() {
    console.log("[晚报] 拉取数据...");
    const [news, ann, globalIndices, sector, concept] = await Promise.all([
        fetchSinaNews(25),
        fetchEastMoneyAnn(15),
        fetchGlobalIndices(),
        fetchSectorRanking(),
        fetchConceptRanking(15)
    ]);
    console.log(`快讯 ${news.length} 条，公告 ${ann.length} 条，AI 分析中...`);

    const newsText = news.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const annText = ann.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const sectorBlock = sector
        ? `## 今日行业板块表现（收盘）
### 涨幅榜 Top8
${sector.top}

### 跌幅榜 Top5
${sector.bottom}

### 主力资金今日净流入榜 Top5（增仓方向）
${sector.inflow}

### 主力资金今日净流出榜 Top5（减仓方向）
${sector.outflow}`
        : "## 行业板块数据\n（本次获取失败，无法参考）";
    const conceptBlock = concept
        ? `## 今日概念板块涨幅榜 Top15（主题炒作强度）\n${concept}`
        : "";

    const prompt = `你是一名"用资金流向和量价关系推演主线"的资深A股分析师。请基于今日全市场板块表现与主力资金真实动向，进行盘后复盘并展望明日。

## 全球主要指数行情（实时）
${globalIndices}

${sectorBlock}

${conceptBlock}

## 今日财经快讯（${news.length}条）
${newsText}

## 今日上市公司公告（${ann.length}条）
${annText}

分析要求（重要）：
1. 主线判断以主力资金净流入的行业板块为准，而不是涨幅榜。
2. 找"暗流"：主力今日净流入很大、但涨幅一般的板块 → 潜在明日发酵方向。
3. 找"顶部信号"：涨幅榜前列但主力净流出的板块 → 高位派发，明日不宜追。
4. 行业板块看主线，概念板块看题材接力节奏——两者共振的方向是真启动。

请严格按以下格式输出：

【今日复盘】
3-4句话：A股今日整体表现，主线是什么，资金主线（真实流入 vs 表面涨幅）。

【资金主线深度 · 谁在偷偷加仓】
1-2条：主力资金净流入大但涨幅平淡的板块（潜伏方向），以及涨幅榜里被资金反向撤退的板块（派发方向）。这是本报的核心。

【全球指数联动分析】
2-3句话：美股/日经/韩股走势对明日A股开盘的传导预判。

【今日亮点个股】
从公告和快讯中筛选3-5条今日有明显信号的个股，格式：
**公司名（代码）** 📈/📉 — 原因一句话

【明日展望】
2-3句话：明日大概率方向，重点关注的板块或事件。

【明日关注清单】
2-3个明日值得重点跟踪的板块或事件，格式：
· 板块/事件名 — 关注原因一句话（标注是"资金驱动"还是"消息驱动"）`;

    const aiText = await callAI(prompt);
    console.log("AI 输出：\n", aiText);

    const errors = getFetchErrors();
    const errorNotice = errors.length ? `\n\n---\n**数据源异常提示**\n${errors.join("\n")}` : "";

    await sendFeishuCard({
        title: "🌆 A股晚报 · 盘后复盘",
        template: "orange",
        content: aiText + errorNotice
    });
}

main().catch(err => {
    console.error("[晚报] 运行失败：", err.message);
    process.exit(1);
});
