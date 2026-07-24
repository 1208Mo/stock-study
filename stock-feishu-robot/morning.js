/**
 * 早报 — 每天 08:30 左右运行
 * 功能：拉取隔夜消息 + 今日重要公告，AI 研判开盘方向
 *
 * 运行方式：node feishu/morning.js
 * 定时任务示例（crontab）：0 9 * * 1-5  cd /path/to/stock-study && node feishu/morning.js
 */

const { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, callAI, sendFeishuCard, getFetchErrors } = require("./common");

async function main() {
    console.log("[早报] 拉取数据...");
    const [news, ann, globalIndices] = await Promise.all([
        fetchSinaNews(20),
        fetchEastMoneyAnn(15),
        fetchGlobalIndices()
    ]);
    console.log(`快讯 ${news.length} 条，公告 ${ann.length} 条，AI 分析中...`);

    const newsText = news.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const annText = ann.map((n, i) => `${i + 1}. ${n}`).join("\n");

    const prompt = `你是一名资深A股分析师。以下是今日开盘前的财经快讯和上市公司公告，请给出开盘前研判。

## 全球主要指数行情（实时）
${globalIndices}

## 财经快讯（${news.length}条）
${newsText}

## 上市公司公告（${ann.length}条）
${annText}

请严格按以下格式输出，不要多余内容：

【全球指数早读】
结合上方美股（道指/标普/纳指）、日经225、韩国KOSPI的涨跌数据，2-3句话说明对A股开盘的传导影响。如：美股科技涨 → A股科技高开；韩国半导体大涨 → 半导体板块情绪受益。

【开盘研判】
3-4句话：判断今日A股开盘方向（高开/低开/平开），核心驱动因素，主要风险点。

【热点板块】
2-3个值得关注的板块，每行格式：板块名 — 逻辑一句话

【重点个股信号】
从公告和快讯中筛选3-5条今日有明确利好或利空信号的个股，格式：
**公司名（代码）** 📈/📉 — 原因一句话

【操作建议】
2-3条简短操作提示，帮助投资者开盘后重点关注什么。`;

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
