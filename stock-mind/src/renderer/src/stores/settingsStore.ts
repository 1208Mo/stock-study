import { create } from 'zustand'

export type AIProvider = 'openai' | 'deepseek' | 'qwen' | 'ernie' | 'volcengine' | 'zhipu'

interface SettingsState {
    aiProvider: AIProvider
    apiKeys: Record<AIProvider, string>
    aiModels: Record<AIProvider, string>
    aiBaseUrls: Record<AIProvider, string>
    // 自定义中转（OpenAI 兼容），开启后全局忽略上面的 provider 选择
    useCustomAI: boolean
    customBaseUrl: string
    customModel: string
    customKey: string
    loaded: boolean
    loadSettings: () => Promise<void>
    saveAIProvider: (provider: AIProvider) => Promise<void>
    saveAPIKey: (provider: AIProvider, key: string) => Promise<void>
    saveAIModel: (provider: AIProvider, model: string) => Promise<void>
    saveAIBaseUrl: (provider: AIProvider, baseUrl: string) => Promise<void>
    saveCustomAI: (cfg: {
        enabled: boolean
        baseUrl: string
        model: string
        key: string
    }) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
    aiProvider: 'deepseek',
    apiKeys: { openai: '', deepseek: '', qwen: '', ernie: '', volcengine: '', zhipu: '' },
    aiModels: { openai: '', deepseek: '', qwen: '', ernie: '', volcengine: '', zhipu: '' },
    aiBaseUrls: { openai: '', deepseek: '', qwen: '', ernie: '', volcengine: '', zhipu: '' },
    useCustomAI: false,
    customBaseUrl: '',
    customModel: '',
    customKey: '',
    loaded: false,

    loadSettings: async () => {
        try {
            const provider = (await window.api.settings.get('ai_provider')) as AIProvider | null

            const keys: Record<AIProvider, string> = {
                openai: '',
                deepseek: '',
                qwen: '',
                ernie: '',
                volcengine: '',
                zhipu: '',
            }
            const models: Record<AIProvider, string> = {
                openai: '',
                deepseek: '',
                qwen: '',
                ernie: '',
                volcengine: '',
                zhipu: '',
            }
            const baseUrls: Record<AIProvider, string> = {
                openai: '',
                deepseek: '',
                qwen: '',
                ernie: '',
                volcengine: '',
                zhipu: '',
            }
            for (const p of Object.keys(keys) as AIProvider[]) {
                keys[p] = (await window.api.settings.get(`ai_key_${p}`)) ?? ''
                models[p] = (await window.api.settings.get(`ai_model_${p}`)) ?? ''
                baseUrls[p] = (await window.api.settings.get(`ai_base_url_${p}`)) ?? ''
            }

            set({
                aiProvider: provider ?? 'deepseek',
                apiKeys: keys,
                aiModels: models,
                aiBaseUrls: baseUrls,
                useCustomAI: (await window.api.settings.get('ai_use_custom')) === '1',
                customBaseUrl: (await window.api.settings.get('ai_custom_base_url')) ?? '',
                customModel: (await window.api.settings.get('ai_custom_model')) ?? '',
                customKey: (await window.api.settings.get('ai_custom_key')) ?? '',
                loaded: true,
            })
        } catch (e) {
            console.error('Failed to load settings:', e)
            set({ loaded: true })
        }
    },

    saveAIProvider: async (provider) => {
        await window.api.settings.set('ai_provider', provider)
        set({ aiProvider: provider })
    },

    saveAPIKey: async (provider, key) => {
        await window.api.settings.set(`ai_key_${provider}`, key)
        set((s) => ({ apiKeys: { ...s.apiKeys, [provider]: key } }))
    },

    saveAIModel: async (provider, model) => {
        await window.api.settings.set(`ai_model_${provider}`, model)
        set((s) => ({ aiModels: { ...s.aiModels, [provider]: model } }))
    },

    saveAIBaseUrl: async (provider, baseUrl) => {
        await window.api.settings.set(`ai_base_url_${provider}`, baseUrl)
        set((s) => ({ aiBaseUrls: { ...s.aiBaseUrls, [provider]: baseUrl } }))
    },

    saveCustomAI: async ({ enabled, baseUrl, model, key }) => {
        await window.api.settings.set('ai_use_custom', enabled ? '1' : '0')
        await window.api.settings.set('ai_custom_base_url', baseUrl)
        await window.api.settings.set('ai_custom_model', model)
        await window.api.settings.set('ai_custom_key', key)
        set({
            useCustomAI: enabled,
            customBaseUrl: baseUrl,
            customModel: model,
            customKey: key,
        })
    },
}))
