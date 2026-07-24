// ===================== 公共配置 =====================
const WEBHOOK_URL = process.env.FEISHU_WEBHOOK;
if (!WEBHOOK_URL) throw new Error("缺少环境变量 FEISHU_WEBHOOK");

const ARK_API_KEY = process.env.ARK_API_KEY;
if (!ARK_API_KEY) throw new Error("缺少环境变量 ARK_API_KEY");
const ARK_MODEL = "deepseek-v4-pro-260425";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

// ===================== 数据拉取 =====================

/** 累积本次运行内所有数据源的失败原因，供主脚本在飞书卡片中回显 */
const _fetchErrors = [];
function _pushFetchError(source, err) {
    const msg = err?.message || String(err);
    _fetchErrors.push(`⚠️ ${source} 获取失败：${msg}`);
}
function getFetchErrors() {
    return _fetchErrors.slice();
}
function resetFetchErrors() {
    _fetchErrors.length = 0;
}

/** 带超时+重试的 fetch，GitHub Actions runner 访问国内接口偶发 fetch failed，需要兜底 */
async function fetchWithRetry(url, options = {}, { retries = 3, timeoutMs = 8000, retryDelayMs = 1500 } = {}) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: ctrl.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (e) {
            clearTimeout(timer);
            lastErr = e;
            console.warn(`[fetch] 第 ${i + 1} 次失败：${e.message}，url=${url.slice(0, 80)}...`);
            if (i < retries - 1) await new Promise(r => setTimeout(r, retryDelayMs));
        }
    }
    throw lastErr;
}

/** 新浪财经快讯 */
async function fetchSinaNews(count = 20) {
    const url = `https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&tag_id=0&page=1&page_size=${count}&type=0&tabtype=0`;
    try {
        const res = await fetchWithRetry(url, {
            headers: { "Referer": "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" }
        });
        const data = JSON.parse(await res.text());
        const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }); // "2026-07-21"
        return (data.result?.data?.feed?.list || [])
            .filter(item => (item.create_time || "").startsWith(today))
            .map(item => item.rich_text || item.text || "")
            .filter(Boolean);
    } catch (e) {
        console.error("[fetchSinaNews] 全部重试失败：", e.message);
        _pushFetchError("新浪财经快讯", e);
        return [];
    }
}

/** 东方财富：拉取全球主要指数行情 */
async function fetchGlobalIndices() {
    const secids = "100.DJIA,100.SPX,100.NDX,100.N225,100.KS11,100.HSI";
    try {
        const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f1,f2,f3,f4,f12,f14&secids=${secids}`;
        const res = await fetchWithRetry(url, {
            headers: { "Referer": "https://www.eastmoney.com/", "User-Agent": "Mozilla/5.0" }
        });
        const data = await res.json();
        const list = data.data?.diff || [];
        return list.map(item => {
            const sign = item.f3 >= 0 ? "+" : "";
            return `${item.f14}（${item.f12}）：${item.f2}  ${sign}${item.f4.toFixed(2)}（${sign}${item.f3}%）`;
        }).join("\n");
    } catch (e) {
        _pushFetchError("全球主要指数", e);
        return "全球指数获取失败：" + e.message;
    }
}

/** 东财上市公司公告标题 */
async function fetchEastMoneyAnn(count = 15) {
    const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?cb=&page_index=1&page_size=${count}&ann_type=SHA,CYB,SZA,BJA&client_source=web&stock_list=`;
    try {
        const res = await fetchWithRetry(url, {
            headers: { "Referer": "https://www.eastmoney.com/", "User-Agent": "Mozilla/5.0" }
        });
        const data = JSON.parse(await res.text());
        return (data.data?.list || [])
            .map(item => item.title || "")
            .filter(Boolean);
    } catch (e) {
        console.error("[fetchEastMoneyAnn] 全部重试失败：", e.message);
        _pushFetchError("东财上市公司公告", e);
        return [];
    }
}

// ===================== AI 调用 =====================

/** 调用火山引擎 ARK（DeepSeek）*/
async function callAI(prompt) {
    try {
        const res = await fetchWithRetry(`${ARK_BASE_URL}/chat/completions`, {
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
        }, { retries: 2, timeoutMs: 60000, retryDelayMs: 2000 });
        const result = await res.json();
        const text = result.choices?.[0]?.message?.content;
        if (!text) {
            const reason = result.error?.message || JSON.stringify(result).slice(0, 200);
            _pushFetchError("AI 分析", new Error(reason));
            return `（AI 分析失败：${reason}）`;
        }
        return text;
    } catch (e) {
        _pushFetchError("AI 分析", e);
        return `（AI 分析失败：${e.message}）`;
    }
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

module.exports = { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, callAI, sendFeishuCard, getFetchErrors, resetFetchErrors };
