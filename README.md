# StockMind 小墨鱼

> 一个面向个人投资者的 A 股学习与投研助手：以 **LangGraph 多 Agent 决策引擎**为核心，结合实时行情、选股、板块雷达、组合管理与信号监控的桌面应用（Electron + React）。

[![CI](https://github.com/1208Mo/stock-study/actions/workflows/ci.yml/badge.svg)](https://github.com/1208Mo/stock-study/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> ⚠️ **免责声明**：本项目仅用于技术学习与个人研究，所有分析与"决策"均由程序/大模型生成，**不构成任何投资建议**。股市有风险，入市需谨慎，据此操作风险自负。

---

## 截图

<!-- TODO: 补充截图或演示 GIF，放在 docs/screenshots/ 下并替换下方链接 -->
<!-- 建议至少放：AI 决策对话、总览 Dashboard、板块雷达、个股 K 线详情 -->

| 每日决策 (AI Chat) | 总览 Dashboard |
| :---: | :---: |
| _待补充截图_ | _待补充截图_ |

| 板块雷达 | 个股详情 |
| :---: | :---: |
| _待补充截图_ | _待补充截图_ |

---

## 核心特性

- **多 Agent 投研决策引擎**（本项目的核心）：基于 LangGraph 构建的决策图，流程为
  `新闻采集 → 市场状态评估 → 候选发现 → 技术过滤 → 分析师层（技术/基本面/消息）→ 多空研究员辩论 → 决策 → 风控否决 → 校验`。
  LLM 只负责产出**结构化建议**（Zod 校验），最终仓位/风控由**代码强约束**，风控节点可否决或降级，永不扩大仓位。
- **多模型支持**：OpenAI 兼容协议，内置 DeepSeek / Qwen / 文心 / 豆包 / 智谱等 provider，也支持自定义中转。
- **实时行情与图表**：日/周/月/分时 K 线、指数行情、市场宽度、资金流向（基于 ECharts）。
- **智能选股 (Screener)**：按技术/基本面条件动态筛选。
- **板块雷达 (Sector Radar)**：板块热力与轮动趋势。
- **组合与自选管理**：持仓成本跟踪、自选分组。
- **信号监控与提醒**：价格/技术信号触发提醒，带交易日历与交易时段判断。
- **小屏盯盘**：置顶迷你小窗（低调灰度模式、透明度、鼠标穿透、老板键一键隐藏），支持 5 分钟涨速异动、止盈/止损线、尾盘提醒，静默模式下提醒只在小窗内闪烁、不弹系统通知。
- **决策历史与复盘**：历史决策记录 + 打分卡（scorecard），用于回看命中情况。
- **策略回测**：含手续费/印花税的简单回测。
- **桌宠交互**：侧边桌宠，承载每日决策入口。

---

## 技术栈

- **桌面框架**：Electron 43 + electron-vite
- **前端**：React 18 + React Router + Zustand + ECharts
- **AI / Agent**：LangChain / LangGraph（`@langchain/langgraph`），OpenAI 兼容调用
- **数据存储**：sql.js（WebAssembly SQLite，原子写 + 自愈恢复）
- **行情数据源**：东方财富（主）→ 新浪财经（兜底），带健康探测与指数退避重试
- **语言 / 测试**：TypeScript 5 + Vitest

## 架构概览

```
stock-study/
├── stock-mind/              # 主应用（Electron 桌面端）
│   └── src/
│       ├── main/            # 主进程
│       │   ├── services/    # 业务逻辑：agent / market / backtest / screener / signalMonitor ...
│       │   ├── db/          # sql.js 数据层
│       │   └── ipc/         # 主进程 ↔ 渲染进程通信
│       ├── renderer/        # React 界面（Dashboard / AIChat / Screener / SectorRadar ...）
│       ├── preload/         # 预加载脚本
│       └── shared/          # 主/渲染共享工具（如技术指标）
└── stock-feishu-robot/      # 飞书播报机器人（早/午/晚报，GitHub Actions 定时触发）
```

决策引擎的核心代码位于 `stock-mind/src/main/services/agent.ts` 与 `researchAgent.ts`。

## 快速开始

### 环境要求

- Node.js **22**（见 `.nvmrc`）
- macOS / Windows

### 安装与运行

```bash
cd stock-mind
npm install

# 配置 AI（二选一）：
#   A. 复制 .env.example 为 .env 并填入 AI_API_KEY（最高优先级）
#   B. 或直接启动后在应用「设置」页里填写 API Key
cp .env.example .env   # 方式 A

# 开发模式
npm run dev

# 打包（当前平台）
npm run dist          # 产物在 stock-mind/dist/
```

> 首次使用 better-sqlite3 相关能力如遇原生模块报错，可执行 `npm run rebuild:sqlite` 针对 Electron 重新编译。

### 配置说明

AI 配置优先级：**环境变量 > 设置页「自定义中转」> 设置页按 provider 配置**。
环境变量字段见 [`stock-mind/.env.example`](./stock-mind/.env.example)：`AI_API_KEY`（必填）、`AI_BASE_URL`、`AI_MODEL`、`AI_FAST_MODEL`（均可选）。

### 测试

```bash
cd stock-mind
npm test          # 运行一次
npm run test:watch
npm run typecheck # 类型检查
```

单元测试覆盖回测、行情解析、技术形态、选股、交易日历、技术指标等核心计算逻辑。
每次向 `main` push 或提 PR 时，GitHub Actions（`.github/workflows/ci.yml`）会自动执行类型检查与单元测试。

## 飞书播报机器人（可选）

`stock-feishu-robot/` 是独立的早/午/晚报脚本，由 `.github/workflows/stock-robot.yml` 定时触发，需在仓库 Secrets 中配置 `ZHIPU_API_KEY` 与 `FEISHU_WEBHOOK`。

## License

[MIT](./LICENSE) © 2026 mozihuan

