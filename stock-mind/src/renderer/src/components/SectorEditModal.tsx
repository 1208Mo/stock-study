import { useState } from 'react'

interface Props {
    title: string
    initialSector: string
    initialSubSector: string
    onClose: () => void
    onSave: (sector: string, subSector: string) => void | Promise<void>
}

// 轻量板块编辑弹窗：替代此前连续两个 window.prompt 的粗糙交互
export default function SectorEditModal({
    title,
    initialSector,
    initialSubSector,
    onClose,
    onSave,
}: Props) {
    const [sector, setSector] = useState(initialSector)
    const [subSector, setSubSector] = useState(initialSubSector)
    const [saving, setSaving] = useState(false)

    async function handleSave() {
        setSaving(true)
        try {
            await onSave(sector.trim(), subSector.trim())
            onClose()
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>编辑板块 · {title}</h2>
                    <button className="btn-close" onClick={onClose}>
                        ×
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-row">
                        <label className="label">板块</label>
                        <input
                            className="input"
                            autoFocus
                            placeholder="如：科技"
                            value={sector}
                            onChange={(e) => setSector(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        />
                    </div>
                    <div className="form-row">
                        <label className="label">细分板块</label>
                        <input
                            className="input"
                            placeholder="如：半导体"
                            value={subSector}
                            onChange={(e) => setSubSector(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        />
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>
                        取消
                    </button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    )
}
