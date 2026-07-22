/**
 * 晚报 — 每天 16:30 左右运行（收盘后）
 * 功能：拉取当日盘后消息 + 公告，AI 复盘今日行情并展望明日
 *
 * 运行方式：node feishu/evening.js
 * 定时任务示例（crontab）：30 16 * * 1-5  cd /path/to/stock-study && node feishu/evening.js
 */

const { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, callAI, sendFeishuCard } = require("./common");

async function main() {
    console.log("[晚报] 拉取数据...");
    const [news, ann, globalIndices] = await Promise.all([
        fetchSinaNews(25),
        fetchEastMoneyAnn(15),
        fetchGlobalIndices()
    ]);
    console.log(`快讯 ${news.length} 条，公告 ${ann.length} 条，AI 分析中...`);

    const newsText = news.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const annText = ann.map((n, i) => `${i + 1}. ${n}`).join("\n");

    const prompt = `你是一名资深A股分析师。以下是今日收盘后的财经快讯和上市公司公告，请进行盘后复盘并展望明日。

## 全球主要指数行情（实时）
${globalIndices}

## 今日财经快讯（${news.length}条）
${newsText}

## 今日上市公司公告（${ann.length}条）
${annText}

请严格按以下格式输出，不要多余内容：

【今日复盘】
3-4句话：总结今日A股整体表现，主线逻辑是什么，哪些板块强势/弱势，资金流向如何。

【全球指数联动分析】
结合上方美股（道指/标普/纳指）、日经225、韩国KOSPI及欧洲主要指数的涨跌数据，2-3句话分析全球资金风险偏好，对明日A股开盘的传导预判。如：美股科技/半导体大涨 → 明日A股科技板块有望高开；韩股半导体领涨 → 半导体/存储方向关注度提升。

【今日亮点个股】
从公告和快讯中筛选3-5条今日有明显信号的个股，格式：
**公司名（代码）** 📈/📉 — 原因一句话

【明日展望】
2-3句话：基于今日盘后信息及全球市场表现，对明日开盘预判，需要重点关注哪些风险或机会。

【明日关注清单】
列出2-3个明日值得重点跟踪的板块或事件，格式：
· 板块/事件名 — 关注原因一句话`;

    const aiText = await callAI(prompt);
    console.log("AI 输出：\n", aiText);

    await sendFeishuCard({
        title: "🌆 A股晚报 · 盘后复盘",
        template: "orange",
        content: aiText
    });
}

main().catch(err => {
    console.error("[晚报] 运行失败：", err.message);
    process.exit(1);
});
