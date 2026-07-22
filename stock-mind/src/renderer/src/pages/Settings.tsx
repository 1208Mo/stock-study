import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import type { AIProvider } from '../stores/settingsStore'
import type { InvestorProfile } from '../types'

const THEMES: { id: string; label: string; sidebar: string; main: string; primary: string }[] = [
    { id: 'dark', label: '深色', sidebar: '#12151f', main: '#0f1117', primary: '#4f8ef7' },
    { id: 'light', label: '浅色', sidebar: '#e8eaf0', main: '#f0f2f5', primary: '#2563eb' },
    { id: 'blue', label: '海蓝', sidebar: '#080d18', main: '#0a0f1e', primary: '#38bdf8' },
    { id: 'green', label: '暗绿', sidebar: '#081008', main: '#0a1209', primary: '#4ade80' },
    { id: 'purple', label: '暗紫', sidebar: '#0b0814', main: '#0e0a1a', primary: '#a78bfa' },
]

function applyTheme(themeId: string) {
    document.documentElement.setAttribute('data-theme', themeId)
    localStorage.setItem('theme', themeId)
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
        alertThreshold,
        loaded,
        loadSettings,
        saveAIProvider,
        saveAPIKey,
        saveAIModel,
        saveAIBaseUrl,
        saveAlertThreshold,
    } = useSettingsStore()
    const [saved, setSaved] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState('')
    const [localProvider, setLocalProvider] = useState<AIProvider>(aiProvider)
    const [localKeys, setLocalKeys] = useState<Record<AIProvider, string>>({
        openai: '',
        deepseek: '',
        qwen: '',
        ernie: '',
    })
    const [localModels, setLocalModels] = useState<Record<AIProvider, string>>({
        openai: '',
        deepseek: '',
        qwen: '',
        ernie: '',
    })
    const [localBaseUrls, setLocalBaseUrls] = useState<Record<AIProvider, string>>({
        openai: '',
        deepseek: '',
        qwen: '',
        ernie: '',
    })
    const [localThreshold, setLocalThreshold] = useState(5)
    const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('theme') || 'dark')
    const [showKey, setShowKey] = useState<Record<AIProvider, boolean>>({
        openai: false,
        deepseek: false,
        qwen: false,
        ernie: false,
    })
    const [profile, setProfile] = useState<InvestorProfile>(EMPTY_PROFILE)
    const [profileSaving, setProfileSaving] = useState(false)
    const [profileSaved, setProfileSaved] = useState(false)
    const [profileError, setProfileError] = useState('')

    useEffect(() => {
        if (!loaded) loadSettings()
        loadInvestorProfile()
    }, [])

    useEffect(() => {
        setLocalProvider(aiProvider)
        setLocalKeys(apiKeys)
        setLocalModels(aiModels)
        setLocalBaseUrls(aiBaseUrls)
        setLocalThreshold(alertThreshold)
    }, [aiProvider, apiKeys, aiModels, aiBaseUrls, alertThreshold])

    async function loadInvestorProfile() {
        try {
            const result = await window.api.memory.getInvestorProfile()
            setProfile(result)
        } catch (e) {
            setProfileError(e instanceof Error ? e.message : '投资记忆加载失败')
        }
    }

    async function handleSaveProfile() {
        setProfileSaving(true)
        setProfileError('')
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
            setProfileSaved(true)
            setTimeout(() => setProfileSaved(false), 2000)
        } catch (e) {
            setProfileError(e instanceof Error ? e.message : '投资记忆保存失败')
        } finally {
            setProfileSaving(false)
        }
    }

    async function handleSave() {
        setSaving(true)
        setSaveError('')
        try {
            if (localProvider !== aiProvider) {
                await saveAIProvider(localProvider)
            }
            for (const p of Object.keys(localKeys) as AIProvider[]) {
                if (localKeys[p] !== apiKeys[p]) await saveAPIKey(p, localKeys[p])
                if (localModels[p] !== aiModels[p]) await saveAIModel(p, localModels[p])
                if (localBaseUrls[p] !== aiBaseUrls[p]) await saveAIBaseUrl(p, localBaseUrls[p])
            }
            const threshold = Math.max(1, Math.min(20, localThreshold || 5))
            await saveAlertThreshold(threshold)
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : '保存失败，请重试')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">设置</h1>
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
                <h2>AI 模型</h2>
                <p className="settings-note">
                    点击卡片选择当前使用的模型，展开后填入 API Key 保存即可。Key 仅存储在本地。
                </p>

                <div className="provider-grid">
                    {PROVIDERS.map((p) => {
                        const isActive = localProvider === p.id
                        const hasKey = localKeys[p.id].trim().length > 0
                        return (
                            <div
                                key={p.id}
                                className={`provider-card2 ${isActive ? 'active' : ''}`}
                                onClick={() => setLocalProvider(p.id)}
                            >
                                <div className="provider-card2-header">
                                    <div className="provider-card2-title">
                                        {isActive && <span className="provider-active-dot" />}
                                        <span className="provider-card-name">{p.label}</span>
                                    </div>
                                    <span
                                        className={`provider-key-status ${hasKey ? 'configured' : 'empty'}`}
                                    >
                                        {hasKey ? '✓ 已配置' : '未配置'}
                                    </span>
                                </div>
                                <div className="provider-card2-model">
                                    {localModels[p.id] || p.defaultModel}
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* 当前选中 provider 的配置字段 */}
                {(() => {
                    const p = PROVIDERS.find((x) => x.id === localProvider)!
                    return (
                        <div className="provider-fields-panel">
                            <div className="provider-fields-title">配置 {p.label}</div>
                            <div className="provider-card-fields">
                                <div className="provider-field-row">
                                    <label>API Key</label>
                                    <div className="input-with-toggle">
                                        <input
                                            className="input"
                                            type={showKey[p.id] ? 'text' : 'password'}
                                            placeholder={p.keyPlaceholder}
                                            value={localKeys[p.id]}
                                            onChange={(e) =>
                                                setLocalKeys({
                                                    ...localKeys,
                                                    [p.id]: e.target.value,
                                                })
                                            }
                                        />
                                        <button
                                            className="btn-toggle-key"
                                            onClick={() =>
                                                setShowKey({
                                                    ...showKey,
                                                    [p.id]: !showKey[p.id],
                                                })
                                            }
                                        >
                                            {showKey[p.id] ? '隐藏' : '显示'}
                                        </button>
                                    </div>
                                </div>
                                <div className="provider-field-row">
                                    <label>模型名</label>
                                    <input
                                        className="input"
                                        placeholder={`默认：${p.defaultModel}`}
                                        value={localModels[p.id]}
                                        onChange={(e) =>
                                            setLocalModels({
                                                ...localModels,
                                                [p.id]: e.target.value,
                                            })
                                        }
                                    />
                                </div>
                                <div className="provider-field-row">
                                    <label>接口地址</label>
                                    <input
                                        className="input"
                                        placeholder="留空使用默认地址（兼容 OpenAI 格式）"
                                        value={localBaseUrls[p.id]}
                                        onChange={(e) =>
                                            setLocalBaseUrls({
                                                ...localBaseUrls,
                                                [p.id]: e.target.value,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    )
                })()}
            </section>

            {/* 异动提醒阈值 */}
            <section className="settings-section">
                <h2>异动提醒阈值</h2>
                <div className="threshold-row">
                    <label className="label">涨跌幅超过</label>
                    <input
                        className="input input-small"
                        type="number"
                        min={1}
                        max={20}
                        value={localThreshold}
                        onChange={(e) =>
                            setLocalThreshold(
                                Math.max(1, Math.min(20, Number(e.target.value) || 5))
                            )
                        }
                    />
                    <span>% 时通知</span>
                </div>
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
                            onChange={(e) => setProfile({ ...profile, avoidTypes: e.target.value })}
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
                {profileError && (
                    <div className="error-msg" style={{ marginBottom: 8 }}>
                        {profileError}
                    </div>
                )}
                <button
                    className="btn-secondary"
                    onClick={handleSaveProfile}
                    disabled={profileSaving}
                >
                    {profileSaving ? '保存中...' : profileSaved ? '已保存 ✓' : '保存长期记忆'}
                </button>
            </section>

            <div className="settings-footer">
                {saveError && (
                    <div className="error-msg" style={{ marginBottom: 8 }}>
                        {saveError}
                    </div>
                )}
                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? '保存中...' : saved ? '已保存 ✓' : '保存设置'}
                </button>
            </div>

            <div className="disclaimer-box">
                <strong>免责声明：</strong>
                本工具所有分析结果仅供参考，不构成投资建议。股市有风险，投资需谨慎。
            </div>
        </div>
    )
}
