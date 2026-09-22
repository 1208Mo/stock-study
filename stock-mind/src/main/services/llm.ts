/**
 * 统一的 ChatOpenAI 工厂
 *
 * agent.ts（决策）与 researchAgent.ts（研究对话）原本各写了一份完全相同的 createLLM，
 * 仅 temperature 不同。抽到这里单一实现，temperature 由调用方按场景传入。
 * 所有 provider 均走 OpenAI 兼容端点（DeepSeek/通义/文心/火山/智谱皆可）。
 */
import { ChatOpenAI } from '@langchain/openai'
import type { AIProvider } from './ai'
import { PROVIDER_DEFAULTS } from './constants'

export function createChatModel(
    provider: AIProvider,
    apiKey: string,
    baseUrl?: string,
    model?: string,
    temperature = 0.7
) {
    const defaults = PROVIDER_DEFAULTS[provider]
    // 兼容用户填入完整地址（含 /chat/completions），LangChain 会自动拼该后缀，需要去掉
    let finalBaseUrl = baseUrl || defaults.baseUrl
    finalBaseUrl = finalBaseUrl.replace(/\/chat\/completions\/?$/, '')
    return new ChatOpenAI({
        apiKey,
        model: model || defaults.model,
        temperature,
        maxTokens: 16384,
        configuration: {
            baseURL: finalBaseUrl,
        },
    })
}
