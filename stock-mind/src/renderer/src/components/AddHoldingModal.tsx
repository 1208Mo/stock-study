import { useRef, useState } from 'react'
import { useHoldingsStore } from '../stores/holdingsStore'
import type { Holding } from '../types'

interface Props {
    onClose: () => void
    editingHolding?: Holding
}

// 从文本中解析股票代码列表（支持持仓记录格式：代码 名称 成本价 持仓量）
function parseCodesFromText(
    text: string
): Array<{ code: string; name: string; costPrice?: number; quantity?: number }> {
    const seen = new Set<string>()
    const results: Array<{ code: string; name: string; costPrice?: number; quantity?: number }> = []
    const lines = text.split(/[\n;；,，]/)
    for (const line of lines) {
        const codeMatch = line.match(/\b(\d{6})\b/)
        if (!codeMatch) continue
        const code = codeMatch[1]
        if (seen.has(code)) continue
        seen.add(code)
        const rest = line.replace(code, '').trim()
        const nums = rest.match(/\d+\.?\d*/g) ?? []
        const name =
            rest
                .replace(/[\d.]+/g, '')
                .replace(/[|,，：:\s]+/g, ' ')
                .trim() || code
        const costPrice = nums[0] ? parseFloat(nums[0]) : undefined
        const quantity = nums[1] ? parseInt(nums[1]) : undefined
        results.push({ code, name, costPrice, quantity })
    }
    return results
}

export default function AddHoldingModal({ onClose, editingHolding }: Props) {
    const { addHolding, updateHolding } = useHoldingsStore()
    const isEdit = !!editingHolding
    const [code, setCode] = useState(editingHolding?.code ?? '')
    const [name, setName] = useState(editingHolding?.name ?? '')
    const [costPrice, setCostPrice] = useState(
        editingHolding ? String(editingHolding.cost_price) : ''
    )
    const [quantity, setQuantity] = useState(editingHolding ? String(editingHolding.quantity) : '')
    const [searching, setSearching] = useState(false)
    const [searchResults, setSearchResults] = useState<{ code: string; name: string }[]>([])
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // 批量识图导入
    const [batchMode, setBatchMode] = useState(false)
    const [batchText, setBatchText] = useState('')
    const [batchParsed, setBatchParsed] = useState<
        Array<{ code: string; name: string; costPrice?: number; quantity?: number }>
    >([])
    const [batchImporting, setBatchImporting] = useState(false)
    const [batchResult, setBatchResult] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)

    async function handleSearchCode() {
        const keyword = code.trim()
        if (!keyword || isEdit) return
        setSearching(true)
        setSearchResults([])
        try {
            const results = await window.api.market.search(keyword)
            if (results.length === 1) {
                // 唯一匹配，直接填入
                setCode(results[0].code)
                setName(results[0].name)
            } else if (results.length > 1) {
                setSearchResults(results.slice(0, 8))
            }
        } catch (e) {
            console.error(e)
        } finally {
            setSearching(false)
        }
    }

    function handlePickResult(r: { code: string; name: string }) {
        setCode(r.code)
        setName(r.name)
        setSearchResults([])
    }

    async function handleSubmit() {
        if (!code || !name || !costPrice || !quantity) {
            setError('请填写所有字段')
            return
        }
        const cp = parseFloat(costPrice)
        const qty = parseInt(quantity)
        if (isNaN(cp) || cp <= 0) {
            setError('成本价必须为正数')
            return
        }
        if (isNaN(qty) || qty <= 0) {
            setError('持仓量必须为正数')
            return
        }
        if (qty % 100 !== 0) {
            setError('持仓量必须是 100 的整数倍（A股最小交易单位 1 手 = 100 股）')
            return
        }
        setSubmitting(true)
        try {
            if (isEdit && editingHolding) {
                await updateHolding(editingHolding.id, cp, qty)
            } else {
                await addHolding(code, name, cp, qty)
            }
            onClose()
        } catch (e: unknown) {
            setError(
                e instanceof Error
                    ? e.message
                    : isEdit
                      ? '更新失败'
                      : '添加失败，该股票可能已在持仓中'
            )
        } finally {
            setSubmitting(false)
        }
    }

    function handleBatchTextChange(text: string) {
        setBatchText(text)
        setBatchParsed(parseCodesFromText(text))
        setBatchResult('')
    }

    async function handleBatchImport() {
        if (batchParsed.length === 0) return
        setBatchImporting(true)
        setBatchResult('')
        let ok = 0,
            fail = 0
        for (const item of batchParsed) {
            try {
                // 先查名称
                let resolvedName = item.name
                if (!resolvedName || resolvedName === item.code) {
                    const results = await window.api.market.search(item.code).catch(() => [])
                    if (results.length > 0) resolvedName = results[0].name
                }
                const cp = item.costPrice ?? 0
                const qty = item.quantity && item.quantity % 100 === 0 ? item.quantity : 100
                await addHolding(item.code, resolvedName, cp, qty)
                ok++
            } catch {
                fail++
            }
        }
        setBatchResult(`导入完成：${ok} 个成功，${fail} 个失败（已在持仓中或数据异常）。`)
        setBatchImporting(false)
        if (ok > 0) {
            setTimeout(onClose, 1500)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isEdit ? `编辑持仓 · ${name}` : '添加持仓'}</h2>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {!isEdit && (
                            <button
                                className={`btn-small ${batchMode ? 'active' : ''}`}
                                style={{ fontSize: 11 }}
                                onClick={() => {
                                    setBatchMode(!batchMode)
                                    setBatchText('')
                                    setBatchParsed([])
                                }}
                            >
                                {batchMode ? '单个添加' : '批量导入'}
                            </button>
                        )}
                        <button className="btn-close" onClick={onClose}>
                            ×
                        </button>
                    </div>
                </div>

                {batchMode ? (
                    <div className="modal-body">
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                            将截图中的持仓文字粘贴到下方，或直接输入股票代码（每行一个）。
                            <br />
                            格式支持：<code>600519 贵州茅台 1750.00 100</code> 或仅{' '}
                            <code>600519</code>
                        </p>
                        <textarea
                            className="input"
                            rows={8}
                            placeholder={'600519 贵州茅台 1750 100\n000858 五粮液\n002594'}
                            value={batchText}
                            onChange={(e) => handleBatchTextChange(e.target.value)}
                            style={{
                                width: '100%',
                                fontFamily: 'monospace',
                                fontSize: 13,
                                resize: 'vertical',
                            }}
                        />
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                        />
                        {batchParsed.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                                识别到{' '}
                                <strong style={{ color: 'var(--text)' }}>
                                    {batchParsed.length}
                                </strong>{' '}
                                个代码：
                                {batchParsed
                                    .map((p) => `${p.code}${p.name !== p.code ? ` ${p.name}` : ''}`)
                                    .join('，')}
                            </div>
                        )}
                        {batchResult && (
                            <div
                                className="error-msg"
                                style={{ color: 'var(--text-muted)', marginTop: 8 }}
                            >
                                {batchResult}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="modal-body">
                        <div className="form-row">
                            <label className="label">股票代码或名称</label>
                            <div className="input-group" style={{ position: 'relative' }}>
                                <input
                                    className="input"
                                    placeholder="输入代码（000001）或名称（平安银行）"
                                    value={code}
                                    disabled={isEdit}
                                    onChange={(e) => {
                                        setCode(e.target.value)
                                        setSearchResults([])
                                    }}
                                    onBlur={() => {
                                        if (!searchResults.length) handleSearchCode()
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSearchCode()
                                    }}
                                />
                                {!isEdit && (
                                    <button
                                        className="btn-small"
                                        onClick={handleSearchCode}
                                        disabled={searching}
                                    >
                                        {searching ? '搜索...' : '搜索'}
                                    </button>
                                )}
                                {searchResults.length > 0 && (
                                    <div className="stock-search-dropdown">
                                        {searchResults.map((r) => (
                                            <div
                                                key={r.code}
                                                className="stock-search-option"
                                                onMouseDown={(e) => {
                                                    e.preventDefault()
                                                    handlePickResult(r)
                                                }}
                                            >
                                                <span className="stock-code">{r.code}</span>
                                                <span className="stock-name">{r.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="form-row">
                            <label className="label">股票名称</label>
                            <input
                                className="input"
                                placeholder="自动填充或手动输入"
                                value={name}
                                disabled={isEdit}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>

                        <div className="form-row">
                            <label className="label">成本价 (元)</label>
                            <input
                                className="input"
                                type="number"
                                step="0.01"
                                placeholder="如：10.50"
                                value={costPrice}
                                onChange={(e) => setCostPrice(e.target.value)}
                            />
                        </div>

                        <div className="form-row">
                            <label className="label">持仓量 (股)</label>
                            <input
                                className="input"
                                type="number"
                                step="100"
                                min="100"
                                placeholder="如：1000（必须是100的整数倍）"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                            />
                            <span className="input-hint">1手=100股，最少填100</span>
                        </div>

                        {error && <div className="error-msg">{error}</div>}
                    </div>
                )}

                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>
                        取消
                    </button>
                    {batchMode ? (
                        <button
                            className="btn-primary"
                            onClick={handleBatchImport}
                            disabled={batchImporting || batchParsed.length === 0}
                        >
                            {batchImporting ? '导入中...' : `导入 ${batchParsed.length} 个`}
                        </button>
                    ) : (
                        <button
                            className="btn-primary"
                            onClick={handleSubmit}
                            disabled={submitting}
                        >
                            {submitting
                                ? isEdit
                                    ? '保存中...'
                                    : '添加中...'
                                : isEdit
                                  ? '保存'
                                  : '添加'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
