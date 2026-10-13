import { defineConfig } from 'vitest/config'

// 只跑纯逻辑单测（指标、形态、选股过滤、回测、持仓计算），不启动 Electron
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
})
