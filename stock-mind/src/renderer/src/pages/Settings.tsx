import { useEffect, useState, useCallback } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import type { AIProvider } from '../stores/settingsStore'
import type { InvestorProfile } from '../types'

const THEMES: { id: string; label: string; sidebar: string; main: string; primary: string }[] = [
    { id: 'dark', label: '深色', sidebar: '#12151f', main: '#0f1117', primary: '#4f8ef7' },
    { id: 'light', label: '浅色', sidebar: '#e8eaf0', main: '#f0f2f5', primary: '#2563eb' },
    { id: 'blue', label: '海蓝', sidebar: '#080d18', main: '#0a0f1e', primary: '#38bdf8' },
    { id: 'green', label: '暗绿', sidebar: '#081008', main: '#0a1209', primary: '#4ade80' },
    { id: 'purple', label: '暗紫', sidebar: '#0b0814', main: '#0e0a1a', primary: '#a78bfa' },
    { id: 'eyecare', label: '护眼', sidebar: '#b8e2be', main: '#c7edcc', primary: '#3f7a55' },
]

function applyTheme(themeId: string) {
    document.documentElement.setAttribute('data-theme', themeId)
    localStorage.setItem('theme', themeId)
    // 通知图表即时重新上色
    window.dispatchEvent(new Event('themechange'))
}

const PROVIDERS: {
    id: AIProvider
    label: string
    keyPlaceholder: string
    defaultModel: string
    docsUrl: string
}[] = [
    {
        id: 'deepseek',
        label: 'DeepSeek',
        keyPlaceholder: 'sk-...',
        defaultModel: 'deepseek-chat',
        docsUrl: 'https://platform.deepseek.com/api_keys',
    },
    {
        id: 'openai',
        label: 'OpenAI',
        keyPlaceholder: 'sk-...',
        defaultModel: 'gpt-4o-mini',
        docsUrl: 'https://platform.openai.com/api-keys',
    },
    {
        id: 'qwen',
        label: '通义千问',
        keyPlaceholder: 'sk-...',
        defaultModel: 'qwen-turbo',
        docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
    },
    {
        id: 'ernie',
        label: '文心千帆',
        keyPlaceholder: 'bce-v3/...',
        defaultModel: 'ernie-4.5-8k-preview',
        docsUrl: 'https://qianfan.cloud.baidu.com/mkl',
    },
    {
        id: 'volcengine',
        label: '火山引擎',
        keyPlaceholder: 'ark-...',
        defaultModel: '（填入接入点ID）',
        docsUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint',
    },
    {
        id: 'zhipu',
        label: '智谱AI',
        keyPlaceholder: 'xxx.xxx',
        defaultModel: 'glm-5.2',
        docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    },
]

const EMPTY_PROFILE: InvestorProfile = {
    capital: 7000,
    riskLevel: '平衡',
    preferredTypes: '宽基ETF、主板蓝筹',
    avoidTypes: 'ST、北交所、高位追涨',
    preferredSectors: '',
    notes: '新手账户，优先控制仓位和回撤。',
    updatedAt: '',
}

export default function Settings() {
    const {
        aiProvider,
        apiKeys,
        aiModels,
        aiBaseUrls,
        useCustomAI,
        customBaseUrl,
        customModel,
        customKey,
        loaded,
        loadSettings,
        saveAIProvider,
        saveAPIKey,
        saveAIModel,
        saveAIBaseUrl,
        saveCustomAI,
    } = useSettingsStore()

    const [localProvider, setLocalProvider] = useState<AIProvider>(aiProvider)
    const [expandedProvider, setExpandedProvider] = useState<AIProvider>(aiProvider)
    const [localKeys, setLocalKeys] = useState<Record<AIProvider, string>>({
        openai: '',
        deepseek: '',
        qwen: '',
        ernie: '',
        volcengine: '',
        zhipu: '',
    })
    const [localModels, setLocalModels] = useState<Record<AIProvider, string>>({
        openai: '',
        deepseek: '',
        qwen: '',
        ernie: '',
        volcengine: '',
        zhipu: '',
    })
    const [localBaseUrls, setLocalBaseUrls] = useState<Record<AIProvider, string>>({
        openai: '',
        deepseek: '',
        qwen: '',
        ernie: '',
        volcengine: '',
        zhipu: '',
    })
    const [localUseCustom, setLocalUseCustom] = useState(false)
    const [localCustomBaseUrl, setLocalCustomBaseUrl] = useState('')
    const [localCustomModel, setLocalCustomModel] = useState('')
    const [localCustomKey, setLocalCustomKey] = useState('')
    const [showCustomKey, setShowCustomKey] = useState(false)
    const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('theme') || 'dark')
    const [showKey, setShowKey] = useState<Record<AIProvider, boolean>>({
        openai: false,
        deepseek: false,
        qwen: false,
        ernie: false,
        volcengine: false,
        zhipu: false,
    })
    const [profile, setProfile] = useState<InvestorProfile>(EMPTY_PROFILE)

    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
    const [saveMessage, setSaveMessage] = useState('')

    useEffect(() => {
        if (!loaded) loadSettings()
        loadInvestorProfile()
    }, [])

    useEffect(() => {
        setLocalProvider(aiProvider)
        setLocalKeys(apiKeys)
        setLocalModels(aiModels)
        setLocalBaseUrls(aiBaseUrls)
        setLocalUseCustom(useCustomAI)
        setLocalCustomBaseUrl(customBaseUrl)
        setLocalCustomModel(customModel)
        setLocalCustomKey(customKey)
    }, [aiProvider, apiKeys, aiModels, aiBaseUrls, useCustomAI, customBaseUrl, customModel, customKey])

    // 仅在初始加载完成时设置展开状态，后续不强制重置，保持用户当前的展开选择
    // 这样编辑非当前选中的模型时，卡片不会被自动折叠
    useEffect(() => {
        if (loaded) {
            setExpandedProvider(aiProvider)
        }
    }, [loaded, aiProvider])

    async function loadInvestorProfile() {
        try {
            const result = await window.api.memory.getInvestorProfile()
            setProfile(result)
        } catch (e) {
            console.error('投资记忆加载失败:', e)
        }
    }

    const showSaveFeedback = useCallback((message: string) => {
        setSaveStatus('saved')
        setSaveMessage(message)
        setTimeout(() => {
            setSaveStatus('idle')
            setSaveMessage('')
        }, 2000)
    }, [])

    useEffect(() => {
        if (!loaded) return
        const debounce = setTimeout(async () => {
            if (localProvider !== aiProvider) {
                setSaveStatus('saving')
                await saveAIProvider(localProvider)
                showSaveFeedback('模型已切换')
            }
        }, 500)
        return () => clearTimeout(debounce)
    }, [localProvider, aiProvider, loaded, saveAIProvider, showSaveFeedback])

    useEffect(() => {
        if (!loaded) return
        const debounce = setTimeout(async () => {
            for (const p of Object.keys(localKeys) as AIProvider[]) {
                if (localKeys[p] !== apiKeys[p]) {
                    setSaveStatus('saving')
                    await saveAPIKey(p, localKeys[p])
                    showSaveFeedback('API Key 已保存')
                }
            }
        }, 500)
        return () => clearTimeout(debounce)
    }, [localKeys, apiKeys, loaded, saveAPIKey, showSaveFeedback])

    useEffect(() => {
        if (!loaded) return
        const debounce = setTimeout(async () => {
            for (const p of Object.keys(localModels) as AIProvider[]) {
                if (localModels[p] !== aiModels[p]) {
                    setSaveStatus('saving')
                    await saveAIModel(p, localModels[p])
                    showSaveFeedback('模型配置已保存')
                }
            }
        }, 500)
        return () => clearTimeout(debounce)
    }, [localModels, aiModels, loaded, saveAIModel, showSaveFeedback])

    useEffect(() => {
        if (!loaded) return
        const debounce = setTimeout(async () => {
            for (const p of Object.keys(localBaseUrls) as AIProvider[]) {
                if (localBaseUrls[p] !== aiBaseUrls[p]) {
                    setSaveStatus('saving')
                    await saveAIBaseUrl(p, localBaseUrls[p])
                    showSaveFeedback('接口地址已保存')
                }
            }
        }, 500)
        return () => clearTimeout(debounce)
    }, [localBaseUrls, aiBaseUrls, loaded, saveAIBaseUrl, showSaveFeedback])

    useEffect(() => {
        if (!loaded) return
        const debounce = setTimeout(async () => {
            if (
                localUseCustom !== useCustomAI ||
                localCustomBaseUrl !== customBaseUrl ||
                localCustomModel !== customModel ||
                localCustomKey !== customKey
            ) {
                setSaveStatus('saving')
                await saveCustomAI({
                    enabled: localUseCustom,
                    baseUrl: localCustomBaseUrl,
                    model: localCustomModel,
                    key: localCustomKey,
                })
                showSaveFeedback('自定义中转已保存')
            }
        }, 500)
        return () => clearTimeout(debounce)
    }, [
        localUseCustom,
        localCustomBaseUrl,
        localCustomModel,
        localCustomKey,
        useCustomAI,
        customBaseUrl,
        customModel,
        customKey,
        loaded,
        saveCustomAI,
        showSaveFeedback,
    ])

    useEffect(() => {
        const debounce = setTimeout(async () => {
            try {
                const savedProfile = await window.api.memory.updateInvestorProfile({
                    capital: profile.capital,
                    riskLevel: profile.riskLevel,
                    preferredTypes: profile.preferredTypes,
                    avoidTypes: profile.avoidTypes,
                    preferredSectors: profile.preferredSectors,
                    notes: profile.notes,
                })
                setProfile(savedProfile)
            } catch (e) {
                console.error('投资记忆保存失败:', e)
            }
        }, 800)
        return () => clearTimeout(debounce)
    }, [profile])

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">设置</h1>
                <div className="settings-save-indicator">
                    {saveStatus === 'saving' && (
                        <span className="save-indicator saving">保存中...</span>
                    )}
                    {saveStatus === 'saved' && (
                        <span className="save-indicator saved">{saveMessage}</span>
                    )}
                </div>
            </div>

            {/* 主题色 */}
            <section className="settings-section">
                <h2>主题色</h2>
                <div className="theme-swatches">
                    {THEMES.map((t) => (
                        <div
                            key={t.id}
                            className={`theme-swatch ${currentTheme === t.id ? 'active' : ''}`}
                            onClick={() => {
                                applyTheme(t.id)
                                setCurrentTheme(t.id)
                                showSaveFeedback('主题已切换')
                            }}
                        >
                            <div className="theme-swatch-preview">
                                <div className="sp-side" style={{ background: t.sidebar }} />
                                <div
                                    className="sp-main"
                                    style={{
                                        background: t.main,
                                        borderLeft: `2px solid ${t.primary}`,
                                    }}
                                />
                            </div>
                            <span className="theme-swatch-label">{t.label}</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* AI 模型 */}
            <section className="settings-section">
                <div className="settings-section-header">
                    <h2>AI 模型</h2>
                    <span className="current-provider-hint">
                        当前使用：
                        <strong>
                            {PROVIDERS.find((p) => p.id === localProvider)?.label ?? localProvider}
                        </strong>
                        {(localModels[localProvider] ||
                            PROVIDERS.find((p) => p.id === localProvider)?.defaultModel) && (
                            <span className="current-provider-model">
                                {' / '}
                                {localModels[localProvider] ||
                                    PROVIDERS.find((p) => p.id === localProvider)?.defaultModel}
                            </span>
                        )}
                    </span>
                </div>
                <p className="settings-note">
                    点击卡片切换模型，点击已选中的卡片展开/收起配置。Key 仅存储在本地。
                </p>

                {/* 自定义中转（OpenAI 兼容）：开启后全局忽略下方供应商选择 */}
                <div className="provider-config-panel" style={{ marginBottom: 12 }}>
                    <div className="provider-config-panel-header">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={localUseCustom}
                                onChange={(e) => setLocalUseCustom(e.target.checked)}
                            />
                            <span>使用自定义中转（OpenAI 兼容）</span>
                        </label>
                    </div>
                    <p className="settings-note">
                        开启后将忽略下方供应商选择，全局使用此中转。也可用环境变量
                        AI_API_KEY / AI_BASE_URL / AI_MODEL 覆盖（优先级最高）。
                    </p>
                    {localUseCustom && (
                        <div className="provider-config-panel-fields">
                            <div className="provider-field-row">
                                <label>接口地址</label>
                                <input
                                    className="input"
                                    placeholder="https://oneapi-comate.baidu-int.com/v1"
                                    value={localCustomBaseUrl}
                                    onChange={(e) => setLocalCustomBaseUrl(e.target.value)}
                                />
                            </div>
                            <div className="provider-field-row">
                                <label>模型名</label>
                                <input
                                    className="input"
                                    placeholder="gpt-5.6-sol"
                                    value={localCustomModel}
                                    onChange={(e) => setLocalCustomModel(e.target.value)}
                                />
                            </div>
                            <div className="provider-field-row">
                                <label>API Key</label>
                                <div className="input-with-toggle">
                                    <input
                                        className="input"
                                        type={showCustomKey ? 'text' : 'password'}
                                        placeholder="sk-..."
                                        value={localCustomKey}
                                        onChange={(e) => setLocalCustomKey(e.target.value)}
                                    />
                                    <button
                                        className="btn-toggle-key"
                                        onClick={() => setShowCustomKey(!showCustomKey)}
                                    >
                                        {showCustomKey ? '隐藏' : '显示'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 网格选择区（开启自定义中转后，下方供应商选择不生效，弱化展示） */}
                {localUseCustom && (
                    <p className="settings-note" style={{ color: 'var(--up)' }}>
                        已启用「自定义中转」，下方供应商选择暂不生效。关闭上方开关后可继续使用。
                    </p>
                )}
                <div
                    className="provider-grid-select"
                    style={
                        localUseCustom
                            ? { opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(0.5)' }
                            : undefined
                    }
                >
                    {PROVIDERS.map((p) => {
                        const isActive = localProvider === p.id
                        const hasKey = localKeys[p.id].trim().length > 0
                        return (
                            <div
                                key={p.id}
                                className={`provider-grid-card ${isActive ? 'active' : ''}`}
                                onClick={() => {
                                    if (isActive) {
                                        // 已选中的再点一次：切换展开/收起
                                        setExpandedProvider(
                                            expandedProvider === p.id ? ('' as AIProvider) : p.id
                                        )
                                    } else {
                                        setLocalProvider(p.id)
                                        setExpandedProvider(p.id)
                                    }
                                }}
                            >
                                <div className="provider-grid-card-top">
                                    <span className="provider-grid-card-name">{p.label}</span>
                                    {isActive && (
                                        <span className="provider-grid-active-badge">使用中</span>
                                    )}
                                </div>
                                <span className="provider-grid-card-model">
                                    {localModels[p.id] || p.defaultModel}
                                </span>
                                <span
                                    className={`provider-grid-card-status ${hasKey ? 'configured' : ''}`}
                                >
                                    {hasKey ? '✓ 已配置' : '未配置'}
                                </span>
                            </div>
                        )
                    })}
                </div>

                {/* 展开的配置面板 */}
                {!localUseCustom && expandedProvider && PROVIDERS.find((p) => p.id === expandedProvider) && (
                    <div className="provider-config-panel">
                        <div className="provider-config-panel-header">
                            <span>
                                配置：{PROVIDERS.find((p) => p.id === expandedProvider)?.label}
                            </span>
                            <a
                                className="provider-docs-link"
                                href={PROVIDERS.find((p) => p.id === expandedProvider)?.docsUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                            >
                                获取 Key →
                            </a>
                        </div>
                        <div className="provider-config-panel-fields">
                            <div className="provider-field-row">
                                <label>API Key</label>
                                <div className="input-with-toggle">
                                    <input
                                        className="input"
                                        type={showKey[expandedProvider] ? 'text' : 'password'}
                                        placeholder={
                                            PROVIDERS.find((p) => p.id === expandedProvider)
                                                ?.keyPlaceholder
                                        }
                                        value={localKeys[expandedProvider]}
                                        onChange={(e) =>
                                            setLocalKeys({
                                                ...localKeys,
                                                [expandedProvider]: e.target.value,
                                            })
                                        }
                                    />
                                    <button
                                        className="btn-toggle-key"
                                        onClick={() =>
                                            setShowKey({
                                                ...showKey,
                                                [expandedProvider]: !showKey[expandedProvider],
                                            })
                                        }
                                    >
                                        {showKey[expandedProvider] ? '隐藏' : '显示'}
                                    </button>
                                </div>
                            </div>
                            <div className="provider-field-row">
                                <label>模型名</label>
                                <input
                                    className="input"
                                    placeholder={`默认：${PROVIDERS.find((p) => p.id === expandedProvider)?.defaultModel}`}
                                    value={localModels[expandedProvider]}
                                    onChange={(e) =>
                                        setLocalModels({
                                            ...localModels,
                                            [expandedProvider]: e.target.value,
                                        })
                                    }
                                />
                            </div>
                            <div className="provider-field-row">
                                <label>接口地址</label>
                                <input
                                    className="input"
                                    placeholder="留空使用默认地址（兼容 OpenAI 格式）"
                                    value={localBaseUrls[expandedProvider]}
                                    onChange={(e) =>
                                        setLocalBaseUrls({
                                            ...localBaseUrls,
                                            [expandedProvider]: e.target.value,
                                        })
                                    }
                                />
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {/* 长期投资记忆 */}
            <section className="settings-section">
                <h2>长期投资记忆</h2>
                <p className="settings-note">
                    这份画像会注入 AI 对话 Agent 和每日决策 Agent，用来约束仓位、风险偏好和标的选择。
                </p>
                <div className="provider-card-fields">
                    <div className="provider-field-row">
                        <label>可用资金</label>
                        <input
                            className="input"
                            type="number"
                            min={0}
                            value={profile.capital ?? ''}
                            onChange={(e) =>
                                setProfile({
                                    ...profile,
                                    capital: e.target.value === '' ? null : Number(e.target.value),
                                })
                            }
                        />
                    </div>
                    <div className="provider-field-row">
                        <label>风险偏好</label>
                        <select
                            className="input"
                            value={profile.riskLevel}
                            onChange={(e) => setProfile({ ...profile, riskLevel: e.target.value })}
                        >
                            <option value="稳一点">稳一点</option>
                            <option value="平衡">平衡</option>
                            <option value="激进">激进</option>
                        </select>
                    </div>
                    <div className="provider-field-row">
                        <label>偏好品种</label>
                        <input
                            className="input"
                            placeholder="例如：宽基ETF、主板蓝筹、红利低波"
                            value={profile.preferredTypes}
                            onChange={(e) =>
                                setProfile({ ...profile, preferredTypes: e.target.value })
                            }
                        />
                    </div>
                    <div className="provider-field-row">
                        <label>回避品种</label>
                        <input
                            className="input"
                            placeholder="例如：ST、北交所、科创板、高位追涨"
                            value={profile.avoidTypes}
                            onChange={(e) =>
                                setProfile({ ...profile, avoidTypes: e.target.value })
                            }
                        />
                    </div>
                    <div className="provider-field-row">
                        <label>偏好板块</label>
                        <input
                            className="input"
                            placeholder="例如：半导体、机器人、红利、消费"
                            value={profile.preferredSectors}
                            onChange={(e) =>
                                setProfile({ ...profile, preferredSectors: e.target.value })
                            }
                        />
                    </div>
                    <div className="provider-field-row">
                        <label>补充备注</label>
                        <textarea
                            className="input"
                            rows={4}
                            placeholder="例如：新手账户，优先控制回撤；不做短线追涨。"
                            value={profile.notes}
                            onChange={(e) => setProfile({ ...profile, notes: e.target.value })}
                        />
                    </div>
                </div>
                {profile.updatedAt && (
                    <p className="settings-note" style={{ marginTop: 8 }}>
                        上次更新：{profile.updatedAt}
                    </p>
                )}
            </section>

            <div className="disclaimer-box">
                <strong>免责声明：</strong>
                本工具所有分析结果仅供参考，不构成投资建议。股市有风险，投资需谨慎。
            </div>
        </div>
    )
}
