/**
 * 午报 — 每天 12:00 运行（午间休市后）
 * 功能：拉取上午行情消息，AI 复盘上午走势并研判下午方向
 *
 * 运行方式：node feishu/noon.js
 * 定时任务：0 12 * * 1-5
 */

const { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, callAI, sendFeishuCard, getFetchErrors } = require("./common");

async function main() {
    console.log("[午报] 拉取数据...");
    const [news, ann, globalIndices] = await Promise.all([
        fetchSinaNews(20),
        fetchEastMoneyAnn(10),
        fetchGlobalIndices()
    ]);
    console.log(`快讯 ${news.length} 条，公告 ${ann.length} 条，AI 分析中...`);

    const newsText = news.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const annText = ann.map((n, i) => `${i + 1}. ${n}`).join("\n");

    const prompt = `你是一名资深A股分析师。以下是今日上午的财经快讯和上市公司公告，请进行午盘复盘并给出下午操作参考。

## 全球主要指数行情（实时）
${globalIndices}

## 财经快讯（${news.length}条）
${newsText}

## 上市公司公告（${ann.length}条）
${annText}

请严格按以下格式输出，不要多余内容：

【上午复盘】
3句话：总结上午A股整体表现，主要涨跌板块，资金情绪如何。

【全球市场午间参考】
结合上方日经225、韩国KOSPI及美股期货的走势数据，1-2句话说明对A股下午的外部影响。

【下午展望】
2-3句话：根据上午走势和消息面，判断下午行情大概率方向，主要关注点。

【下午重点个股提示】
列出2-3只值得跟踪的个股，格式：
**公司名（代码）** — 关注原因一句话

【下午操作提示】
2-3条简短提示，帮助投资者把握下午节奏。`;

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
