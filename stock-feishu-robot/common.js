// ===================== 公共配置 =====================
const WEBHOOK_URL = process.env.FEISHU_WEBHOOK;
if (!WEBHOOK_URL) throw new Error("缺少环境变量 FEISHU_WEBHOOK");

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
if (!ZHIPU_API_KEY) throw new Error("缺少环境变量 ZHIPU_API_KEY");
const ZHIPU_MODEL = "glm-5.2";
const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

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

/** 东方财富：行业板块涨跌 + 主力资金流向
 * fs=m:90+t:2 => 行业板块；fields:
 *   f3=涨跌幅%  f12=板块代码  f14=板块名  f62=主力净流入(元)  f128=领涨股名  f184=主力净占比%
 * 返回四组视角：涨幅榜、跌幅榜、主力净流入榜、主力净流出榜（即资金"暗流"）
 * 注意：使用 numeric 子域 + %2B 编码，避免边缘网关把 + 解码成空格
 */
async function fetchSectorRanking() {
    const url = "https://82.push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m%3A90%2Bt%3A2&fields=f3,f12,f14,f62,f128,f184";
    try {
        const res = await fetchWithRetry(url, {
            headers: {
                "Referer": "https://quote.eastmoney.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
            }
        });
        const data = await res.json();
        const list = (data.data?.diff || []).filter(x => typeof x.f3 === "number");
        if (!list.length) throw new Error("行业板块数据为空");

        const yi = (n) => (typeof n === "number" ? (n / 1e8).toFixed(2) + "亿" : "-");
        const pct = (n) => (typeof n === "number" ? (n >= 0 ? "+" : "") + n.toFixed(2) + "%" : "-");
        const fmtByChange = (x) => `${x.f14}: ${pct(x.f3)}  主力${yi(x.f62)}  领涨:${x.f128 || "-"}`;
        const fmtByFlow   = (x) => `${x.f14}: 主力${yi(x.f62)}  涨跌${pct(x.f3)}  领涨:${x.f128 || "-"}`;

        const byChange = [...list].sort((a, b) => b.f3 - a.f3);
        const byFlow   = [...list].sort((a, b) => (b.f62 || 0) - (a.f62 || 0));

        return {
            top:     byChange.slice(0, 8).map(fmtByChange).join("\n"),
            bottom:  byChange.slice(-5).reverse().map(fmtByChange).join("\n"),
            inflow:  byFlow.slice(0, 5).map(fmtByFlow).join("\n"),
            outflow: byFlow.slice(-5).reverse().map(fmtByFlow).join("\n"),
        };
    } catch (e) {
        _pushFetchError("行业板块涨跌/资金", e);
        return null;
    }
}

/** 东方财富：概念板块涨幅榜（"暗流"更容易冒头的地方）
 * fs=m:90+t:3 => 概念板块
 */
async function fetchConceptRanking(count = 10) {
    const url = `https://82.push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${count}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m%3A90%2Bt%3A3&fields=f3,f12,f14,f62,f128,f184`;
    try {
        const res = await fetchWithRetry(url, {
            headers: {
                "Referer": "https://quote.eastmoney.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
            }
        });
        const data = await res.json();
        const list = (data.data?.diff || []).filter(x => typeof x.f3 === "number");
        if (!list.length) throw new Error("概念板块数据为空");
        const yi = (n) => (typeof n === "number" ? (n / 1e8).toFixed(2) + "亿" : "-");
        const pct = (n) => (typeof n === "number" ? (n >= 0 ? "+" : "") + n.toFixed(2) + "%" : "-");
        return list.map(x => `${x.f14}: ${pct(x.f3)}  主力${yi(x.f62)}  领涨:${x.f128 || "-"}`).join("\n");
    } catch (e) {
        _pushFetchError("概念板块涨幅", e);
        return null;
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

/** 调用智谱 BigModel（GLM），启用 web_search 工具让模型能联网检索 */
async function callAI(prompt) {
    try {
        const res = await fetchWithRetry(`${ZHIPU_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${ZHIPU_API_KEY}`
            },
            body: JSON.stringify({
                model: ZHIPU_MODEL,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                // 开启智谱内置联网检索：让模型自主拉取最新公开网页信息作为参考
                // 覆盖不到微信公众号，但能补充券商研报、财联社、雪球等公开源
                tools: [{ type: "web_search", web_search: { enable: true } }]
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

module.exports = { fetchSinaNews, fetchEastMoneyAnn, fetchGlobalIndices, fetchSectorRanking, fetchConceptRanking, callAI, sendFeishuCard, getFetchErrors, resetFetchErrors };
