/**
 * 午报 — 每天 12:00 运行（午间休市后）
 * 功能：拉取上午行情消息，AI 复盘上午走势并研判下午方向
 *
 * 运行方式：node feishu/noon.js
 * 定时任务：0 12 * * 1-5
 */

const { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, fetchSectorRanking, fetchConceptRanking, callAI, sendFeishuCard, getFetchErrors } = require("./common");

async function main() {
    console.log("[午报] 拉取数据...");
    const [news, ann, globalIndices, sector, concept] = await Promise.all([
        fetchSinaNews(20),
        fetchEastMoneyAnn(10),
        fetchGlobalIndices(),
        fetchSectorRanking(),
        fetchConceptRanking(10)
    ]);
    console.log(`快讯 ${news.length} 条，公告 ${ann.length} 条，AI 分析中...`);

    const newsText = news.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const annText = ann.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const sectorBlock = sector
        ? `## 上午行业板块实时表现
### 涨幅榜 Top8
${sector.top}

### 跌幅榜 Top5
${sector.bottom}

### 主力资金上午净流入榜 Top5
${sector.inflow}

### 主力资金上午净流出榜 Top5（被砸的方向）
${sector.outflow}`
        : "## 行业板块数据\n（本次获取失败，无法参考）";
    const conceptBlock = concept
        ? `## 上午概念板块涨幅榜 Top10（游资炒作方向）\n${concept}`
        : "";

    const prompt = `你是一名"看资金不看新闻标题"的资深A股分析师。请基于上午盘中真实的板块表现与主力资金流向，进行午盘复盘并研判下午方向。

## 全球主要指数行情（实时）
${globalIndices}

${sectorBlock}

${conceptBlock}

## 上午财经快讯（${news.length}条）
${newsText}

## 上午上市公司公告（${ann.length}条）
${annText}

分析要求（重要）：
1. 关注量价与资金的背离：涨得多但主力净流出 → 下午容易回落；跌但主力净流入 → 有承接。
2. 对比行业板块和概念板块：主线一般在行业里，游资炒作在概念里。两者共振的方向下午更值得跟。
3. 找出"暗流"：上午被资金悄悄加仓、但涨幅还不显眼的方向。

请严格按以下格式输出：

【上午复盘】
3句话：上午A股整体表现，主线板块，资金真实态度（进场/撤退/观望）。

【资金真相 · 量价背离警示】
1-2条：涨幅榜里有哪些板块被主力借机出货？跌幅榜里有哪些反而被资金逆势买入？

【全球市场午间参考】
1-2句话：结合日经/韩股实时和美股期货，对A股下午的外部影响。

【下午展望 & 潜伏方向】
2-3句话：下午行情大概率方向；如果有"资金悄悄流入但还没启动"的方向，一并指出。

【下午重点个股提示】
2-3只值得跟踪的个股，格式：**公司名（代码）** — 关注原因一句话

【下午操作提示】
2-3条简短提示，包括风险回避和机会跟进。`;

    const aiText = await callAI(prompt);
    console.log("AI 输出：\n", aiText);

    const errors = getFetchErrors();
    const errorNotice = errors.length ? `\n\n---\n**数据源异常提示**\n${errors.join("\n")}` : "";

    await sendFeishuCard({
        title: "☀️ A股午报 · 下午展望",
        template: "yellow",
        content: aiText + errorNotice
    });
}

main().catch(err => {
    console.error("[午报] 运行失败：", err.message);
    process.exit(1);
});
