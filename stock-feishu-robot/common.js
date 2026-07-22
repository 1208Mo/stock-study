// ===================== 公共配置 =====================
const WEBHOOK_URL = process.env.FEISHU_WEBHOOK;
if (!WEBHOOK_URL) throw new Error("缺少环境变量 FEISHU_WEBHOOK");

const ARK_API_KEY = process.env.ARK_API_KEY;
if (!ARK_API_KEY) throw new Error("缺少环境变量 ARK_API_KEY");
const ARK_MODEL = "deepseek-v4-pro-260425";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

// ===================== 数据拉取 =====================

/** 新浪财经快讯 */
async function fetchSinaNews(count = 20) {
    const url = `https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&tag_id=0&page=1&page_size=${count}&type=0&tabtype=0`;
    const res = await fetch(url, {
        headers: { "Referer": "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" }
    });
    const data = JSON.parse(await res.text());
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }); // "2026-07-21"
    return (data.result?.data?.feed?.list || [])
        .filter(item => (item.create_time || "").startsWith(today))
        .map(item => item.rich_text || item.text || "")
        .filter(Boolean);
}

/** 东方财富：拉取全球主要指数行情 */
async function fetchGlobalIndices() {
    const secids = "100.DJIA,100.SPX,100.NDX,100.N225,100.KS11,100.HSI";
    try {
        const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f1,f2,f3,f4,f12,f14&secids=${secids}`;
        const res = await fetch(url, {
            headers: { "Referer": "https://www.eastmoney.com/", "User-Agent": "Mozilla/5.0" }
        });
        const data = await res.json();
        const list = data.data?.diff || [];
        return list.map(item => {
            const sign = item.f3 >= 0 ? "+" : "";
            return `${item.f14}（${item.f12}）：${item.f2}  ${sign}${item.f4.toFixed(2)}（${sign}${item.f3}%）`;
        }).join("\n");
    } catch (e) {
        return "全球指数获取失败：" + e.message;
    }
}

/** 东财上市公司公告标题 */
async function fetchEastMoneyAnn(count = 15) {
    const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?cb=&page_index=1&page_size=${count}&ann_type=SHA,CYB,SZA,BJA&client_source=web&stock_list=`;
    const res = await fetch(url, {
        headers: { "Referer": "https://www.eastmoney.com/", "User-Agent": "Mozilla/5.0" }
    });
    const data = JSON.parse(await res.text());
    return (data.data?.list || [])
        .map(item => item.title || "")
        .filter(Boolean);
}

// ===================== AI 调用 =====================

/** 调用火山引擎 ARK（DeepSeek）*/
async function callAI(prompt) {
    const res = await fetch(`${ARK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${ARK_API_KEY}`
        },
        body: JSON.stringify({
            model: ARK_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3
        })
    });
    const result = await res.json();
    return result.choices?.[0]?.message?.content || "（AI分析失败）";
}

// ===================== 飞书推送 =====================

/** 推送飞书卡片 */
async function sendFeishuCard({ title, template = "blue", content }) {
    const payload = {
        msg_type: "interactive",
        card: {
            config: { wide_screen_mode: true },
            header: {
                title: { tag: "plain_text", content: title },
                template
            },
            elements: [{
                tag: "div",
                text: { tag: "lark_md", content }
            }]
        }
    };
    const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    console.log("推送结果：", result);
}

module.exports = { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, callAI, sendFeishuCard };
