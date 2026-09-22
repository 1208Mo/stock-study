/**
 * 公共常量 - 各 AI 厂商的默认 baseUrl / model
 *
 * 说明：此表原本在 ai.ts / agent.ts / researchAgent.ts / chat.ts 中各复制了一份，
 * 任一处新增厂商或改地址都得同步改多处、极易漏改。统一抽到这里，各文件 import。
 */
import type { AIProvider } from './ai'

export const PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
    ernie: { baseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-8k-preview' },
    volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
    zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2' },
}
