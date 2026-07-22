import { create } from 'zustand'

export type AIProvider = 'openai' | 'deepseek' | 'qwen' | 'ernie'

interface SettingsState {
    aiProvider: AIProvider
    apiKeys: Record<AIProvider, string>
    aiModels: Record<AIProvider, string>
    aiBaseUrls: Record<AIProvider, string>
    alertThreshold: number // percent, default 5
    loaded: boolean
    loadSettings: () => Promise<void>
    saveAIProvider: (provider: AIProvider) => Promise<void>
    saveAPIKey: (provider: AIProvider, key: string) => Promise<void>
    saveAIModel: (provider: AIProvider, model: string) => Promise<void>
    saveAIBaseUrl: (provider: AIProvider, baseUrl: string) => Promise<void>
    saveAlertThreshold: (threshold: number) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
    aiProvider: 'deepseek',
    apiKeys: { openai: '', deepseek: '', qwen: '', ernie: '' },
    aiModels: { openai: '', deepseek: '', qwen: '', ernie: '' },
    aiBaseUrls: { openai: '', deepseek: '', qwen: '', ernie: '' },
    alertThreshold: 5,
    loaded: false,

    loadSettings: async () => {
        try {
            const provider = (await window.api.settings.get('ai_provider')) as AIProvider | null
            const threshold = await window.api.settings.get('alert_threshold')

            const keys: Record<AIProvider, string> = {
                openai: '',
                deepseek: '',
                qwen: '',
                ernie: '',
            }
            const models: Record<AIProvider, string> = {
                openai: '',
                deepseek: '',
                qwen: '',
                ernie: '',
            }
            const baseUrls: Record<AIProvider, string> = {
                openai: '',
                deepseek: '',
                qwen: '',
                ernie: '',
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
                alertThreshold: threshold ? parseInt(threshold) : 5,
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

    saveAlertThreshold: async (threshold) => {
        await window.api.settings.set('alert_threshold', String(threshold))
        set({ alertThreshold: threshold })
    },
}))
