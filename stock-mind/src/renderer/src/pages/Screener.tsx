import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { stockRoute } from '../utils/routes'
import type {
    Board,
    NumericField,
    PatternId,
    PatternMeta,
    ScreenerCriteria,
    ScreenerPreset,
    ScreenerResult,
    ScreenerRow,
} from '../types'

type Scope = 'all' | 'sector' | 'watchlist' | 'holdings'
type Ranges = Partial<Record<NumericField, { min: string; max: string }>>

const FIELDS: Array<{ key: NumericField; label: string; unit: string; hint: string }> = [
    { key: 'price', label: '股价', unit: '元', hint: '最新价' },
    { key: 'changePercent', label: '今日涨跌幅', unit: '%', hint: '例：2 ~ 7 表示涨 2%~7%' },
    { key: 'amount', label: '成交额', unit: '亿', hint: '流动性门槛，建议 ≥ 1 亿' },
    { key: 'turnover', label: '换手率', unit: '%', hint: '当日成交股数 / 流通股数，越高越活跃' },
    { key: 'volumeRatio', label: '量比', unit: '倍', hint: '今日量 / 过去 5 日同时段均量，> 1.5 算放量' },
    { key: 'pe', label: '市盈率 PE', unit: '倍', hint: '动态市盈率，亏损股为负' },
    { key: 'pb', label: '市净率 PB', unit: '倍', hint: '股价 / 每股净资产，< 1 为破净' },
    { key: 'totalMv', label: '总市值', unit: '亿', hint: '> 500 亿为大盘股' },
    { key: 'floatMv', label: '流通市值', unit: '亿', hint: '< 100 亿为小盘股' },
    { key: 'change60d', label: '60 日涨跌幅', unit: '%', hint: '中期走势强弱' },
    { key: 'changeYtd', label: '年初至今', unit: '%', hint: '今年以来涨跌幅' },
]

const BOARDS: Array<{ key: Board; label: string }> = [
    { key: 'sh_main', label: '沪主板' },
    { key: 'sz_main', label: '深主板' },
    { key: 'cyb', label: '创业板' },
    { key: 'kcb', label: '科创板' },
    { key: 'bj', label: '北交所' },
]

const PRESETS_KEY = 'screener_presets'

const fmt = (v: number | null, d = 2) => (v === null || v === undefined ? '—' : v.toFixed(d))
const pctCls = (v: number | null) => (v === null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '')
function toNumberRanges(r: Ranges): ScreenerCriteria['ranges'] {
    const out: ScreenerCriteria['ranges'] = {}
    for (const [k, v] of Object.entries(r) as Array<[NumericField, { min: string; max: string }]>) {
        const min = v.min.trim() === '' ? null : Number(v.min)
        const max = v.max.trim() === '' ? null : Number(v.max)
        if ((min !== null && Number.isFinite(min)) || (max !== null && Number.isFinite(max))) {
            out[k] = { min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null }
        }
    }
    return out
}

function toTextRanges(r: ScreenerCriteria['ranges']): Ranges {
    const out: Ranges = {}
    for (const [k, v] of Object.entries(r ?? {}) as Array<[NumericField, { min?: number | null; max?: number | null }]>) {
        out[k] = { min: v.min != null ? String(v.min) : '', max: v.max != null ? String(v.max) : '' }
    }
    return out
}

function loadUserPresets(raw: string | null): ScreenerPreset[] {
    try {
        const list = JSON.parse(raw || '[]')
        return Array.isArray(list) ? list : []
    } catch {
        return []
    }
}

function exportCsv(rows: ScreenerRow[], patterns: PatternMeta[]) {
    const nameOf = new Map(patterns.map((p) => [p.id, p.name]))
    const header = ['代码', '名称', '最新价', '涨跌幅%', '成交额(亿)', '换手率%', '量比', 'PE', 'PB', '总市值(亿)', '流通市值(亿)', '60日%', '年初至今%', '行业', '命中形态']
    const lines = rows.map((r) =>
        [
            r.code,
            r.name,
            r.price,
            r.changePercent,
            r.amount?.toFixed(2),
            r.turnover,
            r.volumeRatio,
            r.pe,
            r.pb,
            r.totalMv?.toFixed(1),
            r.floatMv?.toFixed(1),
            r.change60d,
            r.changeYtd,
            r.industry,
            r.patternHits.map((h) => nameOf.get(h.id) ?? h.id).join('/'),
        ]
            .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
            .join(',')
    )
    // 加 BOM，Excel 打开中文不乱码
    const blob = new Blob(['\ufeff' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `选股结果-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export default function Screener() {
    const navigate = useNavigate()
    const [patterns, setPatterns] = useState<PatternMeta[]>([])
    const [builtinPresets, setBuiltinPresets] = useState<ScreenerPreset[]>([])
    const [userPresets, setUserPresets] = useState<ScreenerPreset[]>([])
    const [activePreset, setActivePreset] = useState<string | null>(null)
    const [sectors, setSectors] = useState<Array<{ code: string; name: string }>>([])

    // 条件
    const [scope, setScope] = useState<Scope>('all')
    const [sectorCode, setSectorCode] = useState('')
    const [ranges, setRanges] = useState<Ranges>({})
    const [boards, setBoards] = useState<Board[]>([])
    const [excludeST, setExcludeST] = useState(true)
    const [excludeSuspended, setExcludeSuspended] = useState(true)
    const [selPatterns, setSelPatterns] = useState<PatternId[]>([])
    const [patternMode, setPatternMode] = useState<'all' | 'any'>('all')
    const [maxScan, setMaxScan] = useState(300)
    const [sortBy, setSortBy] = useState<NumericField>('amount')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
    const [limit, setLimit] = useState(100)

    // 运行状态
    const [running, setRunning] = useState(false)
    const [progress, setProgress] = useState<{ done: number; total: number; hits: number } | null>(null)
    const [result, setResult] = useState<ScreenerResult | null>(null)
    const [error, setError] = useState('')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [toast, setToast] = useState('')
    const [presetName, setPresetName] = useState('')
    const [savingPreset, setSavingPreset] = useState(false)
    const requestRef = useRef<string | null>(null)

    useEffect(() => {
        window.api.screener.meta().then((m) => {
            setPatterns(m.patterns)
            setBuiltinPresets(m.presets)
        })
        window.api.settings.get(PRESETS_KEY).then((raw) => setUserPresets(loadUserPresets(raw)))
        window.api.market
            .getTopSectors(100)
            .then((list) => setSectors(list.map((s) => ({ code: s.code, name: s.name })).sort((a, b) => a.name.localeCompare(b.name, 'zh'))))
            .catch(() => {})
        return window.api.screener.onProgress((p) => {
            if (p.requestId === requestRef.current) setProgress({ done: p.done, total: p.total, hits: p.hits })
        })
    }, [])

    const flash = (msg: string) => {
        setToast(msg)
        setTimeout(() => setToast(''), 2500)
    }
    function applyPreset(p: ScreenerPreset) {
        const c = p.criteria
        setActivePreset(p.id)
        setRanges(toTextRanges(c.ranges))
        setBoards(c.boards ?? [])
        setExcludeST(c.excludeST ?? true)
        setExcludeSuspended(c.excludeSuspended ?? true)
        setSelPatterns(c.patterns ?? [])
        setPatternMode(c.patternMode ?? 'all')
        setSortBy(c.sortBy ?? 'amount')
        setSortDir(c.sortDir ?? 'desc')
        if (c.maxScan) setMaxScan(c.maxScan)
        if (c.limit) setLimit(c.limit)
    }

    function resetAll() {
        setActivePreset(null)
        setRanges({})
        setBoards([])
        setSelPatterns([])
        setPatternMode('all')
        setSortBy('amount')
        setSortDir('desc')
    }

    function currentCriteria(): Omit<ScreenerCriteria, 'scope'> {
        return {
            ranges: toNumberRanges(ranges),
            boards,
            excludeST,
            excludeSuspended,
            patterns: selPatterns,
            patternMode,
            maxScan,
            sortBy,
            sortDir,
            limit,
        }
    }

    async function buildScope(): Promise<ScreenerCriteria['scope']> {
        if (scope === 'sector') {
            if (!sectorCode) throw new Error('请先选择一个板块')
            return { type: 'sector', code: sectorCode, name: sectors.find((s) => s.code === sectorCode)?.name }
        }
        if (scope === 'watchlist') {
            const list = await window.api.watchlist.getAll()
            return { type: 'codes', codes: list.map((w) => w.code) }
        }
        if (scope === 'holdings') {
            const list = await window.api.holdings.getAll()
            return { type: 'codes', codes: list.map((h) => h.code) }
        }
        return { type: 'all' }
    }
    async function run() {
        setError('')
        setSelected(new Set())
        const requestId = `scr-${Date.now()}`
        requestRef.current = requestId
        setRunning(true)
        setProgress(null)
        try {
            const criteria: ScreenerCriteria = { scope: await buildScope(), ...currentCriteria() }
            const r = await window.api.screener.run(criteria, requestId)
            if (requestRef.current === requestId) setResult(r)
        } catch (e) {
            setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '选股失败')
        } finally {
            if (requestRef.current === requestId) {
                setRunning(false)
                setProgress(null)
            }
        }
    }

    function cancel() {
        if (requestRef.current) window.api.screener.cancel(requestRef.current)
    }

    async function savePreset() {
        const name = presetName.trim()
        if (!name) return
        const preset: ScreenerPreset = {
            id: `user-${Date.now()}`,
            name,
            description: '我的自定义条件',
            criteria: currentCriteria(),
        }
        const next = [...userPresets.filter((p) => p.name !== name), preset]
        await window.api.settings.set(PRESETS_KEY, JSON.stringify(next))
        setUserPresets(next)
        setActivePreset(preset.id)
        setPresetName('')
        setSavingPreset(false)
        flash(`已保存模板「${name}」`)
    }

    async function deletePreset(id: string) {
        const next = userPresets.filter((p) => p.id !== id)
        await window.api.settings.set(PRESETS_KEY, JSON.stringify(next))
        setUserPresets(next)
        if (activePreset === id) setActivePreset(null)
    }

    const rows = result?.rows ?? []
    const pickedRows = rows.filter((r) => selected.has(r.code))
    const targetRows = pickedRows.length > 0 ? pickedRows : rows
    const patternName = useMemo(() => new Map(patterns.map((p) => [p.id, p.name])), [patterns])
    // 表头点击：在已有结果上本地重排，不重新请求
    const [viewSort, setViewSort] = useState<{ by: NumericField; dir: 'asc' | 'desc' } | null>(null)
    const viewRows = useMemo(() => {
        if (!viewSort) return rows
        const sign = viewSort.dir === 'asc' ? 1 : -1
        return [...rows].sort((a, b) => {
            const [x, y] = [a[viewSort.by], b[viewSort.by]]
            if (x === null) return 1
            if (y === null) return -1
            return (x - y) * sign
        })
    }, [rows, viewSort])
    useEffect(() => setViewSort(null), [result])

    async function addToWatchlist(list: ScreenerRow[]) {
        for (const r of list) await window.api.watchlist.add(r.code, r.name, '条件选股', r.industry)
        flash(`已加入观察列表 ${list.length} 只`)
    }

    async function addToSignalPool(list: ScreenerRow[]) {
        const added = await window.api.signals.addWatch(list.map((r) => ({ code: r.code, name: r.name })))
        flash(added > 0 ? `已加入监控池 ${added} 只，正在回填历史信号` : '这些股票都已在监控池中')
    }

    function askAI(list: ScreenerRow[]) {
        const top = list.slice(0, 10)
        const names = top.map((r) => `${r.name}（${r.code}）`).join('、')
        navigate(`/chat?q=${encodeURIComponent(`我用条件选股筛出了这些股票：${names}。帮我逐只点评基本面和技术面，挑出最值得关注的 3 只并说明风险。`)}`)
    }

    function toggleSelect(code: string) {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(code)) next.delete(code)
            else next.add(code)
            return next
        })
    }

    const setRange = (key: NumericField, side: 'min' | 'max', value: string) => {
        setActivePreset(null)
        setRanges((prev) => ({ ...prev, [key]: { min: prev[key]?.min ?? '', max: prev[key]?.max ?? '', [side]: value } }))
    }

    const headerCell = (label: string, key?: NumericField) => (
        <th
            className={key ? 'sortable' : ''}
            onClick={() =>
                key && setViewSort((s) => ({ by: key, dir: s?.by === key && s.dir === 'desc' ? 'asc' : 'desc' }))
            }
        >
            {label}
            {key && viewSort?.by === key ? (viewSort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
        </th>
    )

    const presets = [...builtinPresets, ...userPresets]
    return (
        <div className="page screener-page">
            <div className="page-header">
                <h1 className="page-title">条件选股</h1>
                {toast && <span className="screener-toast">{toast}</span>}
            </div>

            <div className="dash-card">
                <div className="dash-card-header">
                    <h3>策略模板</h3>
                    <span className="dash-card-meta">点一下套用条件，可以再微调；仅供学习参考，不构成投资建议</span>
                </div>
                <div className="screener-presets">
                    {presets.map((p) => (
                        <div
                            key={p.id}
                            className={`screener-preset ${activePreset === p.id ? 'active' : ''}`}
                            onClick={() => applyPreset(p)}
                            title={p.description}
                        >
                            <div className="screener-preset-name">
                                {p.name}
                                {!p.builtin && (
                                    <button
                                        className="screener-preset-del"
                                        title="删除模板"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            deletePreset(p.id)
                                        }}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                            <div className="screener-preset-desc">{p.description}</div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="dash-card">
                <div className="dash-card-header">
                    <h3>筛选条件</h3>
                    <button className="btn-small" onClick={resetAll}>
                        清空条件
                    </button>
                </div>

                <div className="screener-row">
                    <span className="screener-label">选股范围</span>
                    {(
                        [
                            ['all', '全部 A 股'],
                            ['sector', '指定板块'],
                            ['watchlist', '我的观察列表'],
                            ['holdings', '我的持仓'],
                        ] as Array<[Scope, string]>
                    ).map(([k, label]) => (
                        <button key={k} className={`btn-day ${scope === k ? 'active' : ''}`} onClick={() => setScope(k)}>
                            {label}
                        </button>
                    ))}
                    {scope === 'sector' && (
                        <select className="input screener-select" value={sectorCode} onChange={(e) => setSectorCode(e.target.value)}>
                            <option value="">选择板块…</option>
                            {sectors.map((s) => (
                                <option key={s.code} value={s.code}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <div className="screener-fields">
                    {FIELDS.map((f) => (
                        <div key={f.key} className="screener-field" title={f.hint}>
                            <span className="screener-field-label">
                                {f.label}
                                <span className="dash-muted">（{f.unit}）</span>
                            </span>
                            <div className="screener-field-inputs">
                                <input
                                    className="input"
                                    type="number"
                                    placeholder="最小"
                                    value={ranges[f.key]?.min ?? ''}
                                    onChange={(e) => setRange(f.key, 'min', e.target.value)}
                                />
                                <span className="dash-muted">~</span>
                                <input
                                    className="input"
                                    type="number"
                                    placeholder="最大"
                                    value={ranges[f.key]?.max ?? ''}
                                    onChange={(e) => setRange(f.key, 'max', e.target.value)}
                                />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="screener-row">
                    <span className="screener-label">板块</span>
                    {BOARDS.map((b) => (
                        <button
                            key={b.key}
                            className={`btn-day ${boards.includes(b.key) ? 'active' : ''}`}
                            onClick={() => setBoards((prev) => (prev.includes(b.key) ? prev.filter((x) => x !== b.key) : [...prev, b.key]))}
                        >
                            {b.label}
                        </button>
                    ))}
                    <span className="dash-muted">{boards.length === 0 ? '不选 = 全部' : ''}</span>
                    <label className="screener-check">
                        <input type="checkbox" checked={excludeST} onChange={(e) => setExcludeST(e.target.checked)} />
                        剔除 ST / 退市
                    </label>
                    <label className="screener-check">
                        <input type="checkbox" checked={excludeSuspended} onChange={(e) => setExcludeSuspended(e.target.checked)} />
                        剔除停牌
                    </label>
                </div>

                <div className="screener-row screener-row-top">
                    <span className="screener-label">技术形态</span>
                    <div className="screener-patterns">
                        {patterns.map((p) => (
                            <button
                                key={p.id}
                                className={`screener-pattern ${selPatterns.includes(p.id) ? 'active' : ''}`}
                                title={p.description}
                                onClick={() => {
                                    setActivePreset(null)
                                    setSelPatterns((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                                }}
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>
                {selPatterns.length > 1 && (
                    <div className="screener-row">
                        <span className="screener-label" />
                        <button className={`btn-day ${patternMode === 'all' ? 'active' : ''}`} onClick={() => setPatternMode('all')}>
                            同时满足
                        </button>
                        <button className={`btn-day ${patternMode === 'any' ? 'active' : ''}`} onClick={() => setPatternMode('any')}>
                            满足任一
                        </button>
                    </div>
                )}
                <div className="screener-row">
                    <span className="screener-label">排序</span>
                    <select className="input screener-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as NumericField)}>
                        {FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                    <button className="btn-day" onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}>
                        {sortDir === 'desc' ? '从高到低' : '从低到高'}
                    </button>
                    <span className="screener-label">最多显示</span>
                    <select className="input screener-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                        {[50, 100, 200, 500].map((n) => (
                            <option key={n} value={n}>
                                {n} 只
                            </option>
                        ))}
                    </select>
                    {selPatterns.length > 0 && (
                        <>
                            <span className="screener-label" title="形态需要逐只拉K线，按成交额从高到低最多扫描这么多只">
                                形态扫描上限
                            </span>
                            <select className="input screener-select" value={maxScan} onChange={(e) => setMaxScan(Number(e.target.value))}>
                                {[100, 300, 600, 1000, 1500].map((n) => (
                                    <option key={n} value={n}>
                                        {n} 只
                                    </option>
                                ))}
                            </select>
                        </>
                    )}
                </div>

                <div className="screener-actions">
                    {running ? (
                        <button className="btn-secondary" onClick={cancel}>
                            停止扫描
                        </button>
                    ) : (
                        <button className="btn-primary" onClick={run}>
                            开始选股
                        </button>
                    )}
                    {savingPreset ? (
                        <>
                            <input
                                className="input screener-preset-input"
                                autoFocus
                                placeholder="模板名称"
                                value={presetName}
                                onChange={(e) => setPresetName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && savePreset()}
                            />
                            <button className="btn-small" onClick={savePreset} disabled={!presetName.trim()}>
                                保存
                            </button>
                            <button className="btn-small" onClick={() => setSavingPreset(false)}>
                                取消
                            </button>
                        </>
                    ) : (
                        <button className="btn-small" onClick={() => setSavingPreset(true)}>
                            保存为我的模板
                        </button>
                    )}
                    {running && (
                        <div className="screener-progress">
                            {progress ? (
                                <>
                                    <div className="screener-progress-bar">
                                        <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                                    </div>
                                    <span className="dash-muted">
                                        形态扫描 {progress.done}/{progress.total}，已命中 {progress.hits} 只
                                    </span>
                                </>
                            ) : (
                                <span className="dash-muted">正在拉取行情快照…</span>
                            )}
                        </div>
                    )}
                </div>
                {error && <div className="error-msg">{error}</div>}
            </div>

            {result && (
                <div className="dash-card">
                    <div className="dash-card-header">
                        <h3>
                            选股结果 <span className="dash-muted">{rows.length} 只</span>
                        </h3>
                        <span className="dash-card-meta">
                            {result.universe} 只参与 → 数值条件后 {result.afterFilter} 只
                            {selPatterns.length > 0 && ` → 扫描 ${result.scanned} 只形态`}
                            {result.scanFailed > 0 && `（${result.scanFailed} 只K线获取失败）`}
                            {result.cancelled && ' · 已手动停止'}
                            {' · '}
                            {(result.elapsedMs / 1000).toFixed(1)}s · 数据源 {result.source === 'eastmoney' ? '东方财富' : '新浪（无量比/60日涨幅/行业字段）'}
                        </span>
                    </div>
                    {result.ignoredFilters.length > 0 && (
                        <div className="screener-note screener-note-warn">
                            ⚠ 当前数据源（{result.source === 'sina' ? '新浪' : '东方财富'}）不提供
                            {result.ignoredFilters.map((f) => FIELDS.find((x) => x.key === f)?.label ?? f).join('、')}，
                            这些筛选条件本次已被忽略。等东方财富数据源恢复后重新选股即可生效。
                        </div>
                    )}
                    {result.truncated && (
                        <div className="screener-note">
                            结果被截断：数值条件筛出的股票多于形态扫描上限或显示上限，可以收紧条件或调高上限。
                        </div>
                    )}
                    {rows.length > 0 && (
                        <div className="screener-batch">
                            <span className="dash-muted">{pickedRows.length > 0 ? `已选 ${pickedRows.length} 只：` : '对全部结果：'}</span>
                            <button className="btn-small" onClick={() => addToWatchlist(targetRows)}>
                                加入观察列表
                            </button>
                            <button className="btn-small" onClick={() => addToSignalPool(targetRows)} title="加入技术信号监控池，盘中出现买卖点时提醒">
                                加入信号监控
                            </button>
                            <button className="btn-small" onClick={() => exportCsv(targetRows, patterns)}>
                                导出 CSV
                            </button>
                            <button className="btn-small" onClick={() => askAI(targetRows)} title="把前 10 只发给小墨鱼 AI 点评">
                                ✨ 问小墨鱼
                            </button>
                        </div>
                    )}
                    {rows.length === 0 ? (
                        <div className="dash-empty">
                            <span>没有符合条件的股票</span>
                            <span className="dash-muted">试试放宽数值范围，或把形态组合改成「满足任一」</span>
                        </div>
                    ) : (
                        <div className="screener-table-wrap">
                            <table className="screener-table">
                                <thead>
                                    <tr>
                                        <th>
                                            <input
                                                type="checkbox"
                                                checked={selected.size === rows.length}
                                                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.code)) : new Set())}
                                            />
                                        </th>
                                        {headerCell('股票')}
                                        {headerCell('现价', 'price')}
                                        {headerCell('涨跌幅', 'changePercent')}
                                        {headerCell('成交额(亿)', 'amount')}
                                        {headerCell('换手%', 'turnover')}
                                        {headerCell('量比', 'volumeRatio')}
                                        {headerCell('PE', 'pe')}
                                        {headerCell('PB', 'pb')}
                                        {headerCell('总市值(亿)', 'totalMv')}
                                        {headerCell('60日', 'change60d')}
                                        {headerCell('行业')}
                                        {selPatterns.length > 0 && headerCell('命中形态')}
                                        {headerCell('')}
                                    </tr>
                                </thead>
                                <tbody>
                                    {viewRows.map((r) => (
                                        <tr key={r.code} className={selected.has(r.code) ? 'selected' : ''}>
                                            <td>
                                                <input type="checkbox" checked={selected.has(r.code)} onChange={() => toggleSelect(r.code)} />
                                            </td>
                                            <td className="screener-name" onClick={() => navigate(stockRoute(r.code, r.name))}>
                                                <span>{r.name}</span>
                                                <span className="dash-muted">{r.code}</span>
                                            </td>
                                            <td>{fmt(r.price)}</td>
                                            <td className={pctCls(r.changePercent)}>{fmt(r.changePercent)}%</td>
                                            <td>{fmt(r.amount)}</td>
                                            <td>{fmt(r.turnover)}</td>
                                            <td>{fmt(r.volumeRatio)}</td>
                                            <td>{fmt(r.pe, 1)}</td>
                                            <td>{fmt(r.pb)}</td>
                                            <td>{fmt(r.totalMv, 0)}</td>
                                            <td className={pctCls(r.change60d)}>{r.change60d === null ? '—' : `${fmt(r.change60d)}%`}</td>
                                            <td className="dash-muted">{r.industry || '—'}</td>
                                            {selPatterns.length > 0 && (
                                                <td>
                                                    {r.patternHits.map((h) => (
                                                        <span key={h.id} className="screener-hit" title={h.reason}>
                                                            {patternName.get(h.id) ?? h.id}
                                                        </span>
                                                    ))}
                                                </td>
                                            )}
                                            <td className="screener-ops">
                                                <button className="btn-link" onClick={() => navigate(`${stockRoute(r.code, r.name)}#backtest`)}>
                                                    详情/回测
                                                </button>
                                                <button className="btn-link" onClick={() => addToSignalPool([r])}>
                                                    盯信号
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
