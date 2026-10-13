import { useState } from 'react'
import type { PriceAlertKind } from '../types'

interface Props {
    code: string
    name: string
    /** 当前价，用来生成快捷价位和校验方向 */
    price?: number
    onClose: () => void
    onSaved?: () => void
}

const KIND_OPTIONS: Array<{ kind: PriceAlertKind; label: string; unit: string }> = [
    { kind: 'price_above', label: '股价涨到', unit: '元' },
    { kind: 'price_below', label: '股价跌到', unit: '元' },
    { kind: 'pct_above', label: '当日涨幅超过', unit: '%' },
    { kind: 'pct_below', label: '当日跌幅超过', unit: '%' },
]

export default function AlertModal({ code, name, price, onClose, onSaved }: Props) {
    const [kind, setKind] = useState<PriceAlertKind>('price_below')
    const [target, setTarget] = useState(price ? (price * 0.95).toFixed(2) : '')
    const [note, setNote] = useState('')
    const [repeatDaily, setRepeatDaily] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const isPrice = kind === 'price_above' || kind === 'price_below'
    const unit = KIND_OPTIONS.find((o) => o.kind === kind)!.unit

    const switchKind = (k: PriceAlertKind) => {
        setKind(k)
        setError(null)
        if (k === 'price_above' && price) setTarget((price * 1.05).toFixed(2))
        else if (k === 'price_below' && price) setTarget((price * 0.95).toFixed(2))
        else setTarget('5')
    }

    const presets = price
        ? isPrice
            ? (kind === 'price_above' ? [3, 5, 10] : [-3, -5, -8]).map((p) => ({
                  label: `${p > 0 ? '+' : ''}${p}%`,
                  value: (price * (1 + p / 100)).toFixed(2),
              }))
            : [3, 5, 7].map((p) => ({ label: `${p}%`, value: String(p) }))
        : []

    const handleSave = async () => {
        const t = parseFloat(target)
        if (!Number.isFinite(t) || t <= 0) {
            setError('请输入大于 0 的数字')
            return
        }
        if (price && kind === 'price_above' && t <= price) {
            setError(`现价 ${price} 已经高于这个价位，会立即触发`)
            return
        }
        if (price && kind === 'price_below' && t >= price) {
            setError(`现价 ${price} 已经低于这个价位，会立即触发`)
            return
        }
        setSaving(true)
        try {
            await window.api.alerts.add({ code, name, kind, target: t, note: note.trim(), repeatDaily })
            onSaved?.()
            onClose()
        } catch (e) {
            setError(String(e))
            setSaving(false)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        🔔 价格提醒 · {name}
                        {price ? <span className="alert-modal-price">现价 {price}</span> : null}
                    </h2>
                    <button className="btn-close" onClick={onClose}>
                        ×
                    </button>
                </div>
                <div className="modal-body">
                    <div className="alert-kind-tabs">
                        {KIND_OPTIONS.map((o) => (
                            <button
                                key={o.kind}
                                className={`alert-kind-tab ${kind === o.kind ? 'active' : ''}`}
                                onClick={() => switchKind(o.kind)}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                    <div className="form-row">
                        <label className="label">触发值（{unit}）</label>
                        <input
                            className="input"
                            autoFocus
                            type="number"
                            step={isPrice ? 0.01 : 0.5}
                            value={target}
                            onChange={(e) => {
                                setTarget(e.target.value)
                                setError(null)
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        />
                        {presets.length > 0 && (
                            <div className="alert-presets">
                                {presets.map((p) => (
                                    <button key={p.label} className="btn-small" onClick={() => setTarget(p.value)}>
                                        {p.label}
                                        {isPrice ? ` → ${p.value}` : ''}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="form-row">
                        <label className="label">备注（可选）</label>
                        <input
                            className="input"
                            placeholder="如：跌破止损位考虑减仓"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </div>
                    <label className="alert-repeat">
                        <input type="checkbox" checked={repeatDaily} onChange={(e) => setRepeatDaily(e.target.checked)} />
                        每天重复提醒（不勾选则触发一次后自动关闭）
                    </label>
                    <div className="input-hint">交易时段每 20 秒检查一次，触发后发系统通知，桌宠也会提醒你。</div>
                    {error && <div className="alert-error">{error}</div>}
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>
                        取消
                    </button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '保存中...' : '保存提醒'}
                    </button>
                </div>
            </div>
        </div>
    )
}
