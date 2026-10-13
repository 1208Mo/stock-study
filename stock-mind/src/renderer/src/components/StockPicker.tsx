import { useEffect, useRef, useState } from 'react'

/** 股票搜索选择框：输入代码或名称，下拉选中后回调 */
export default function StockPicker({
    onPick,
    placeholder = '输入代码或名称搜索股票…',
}: {
    onPick: (s: { code: string; name: string }) => void
    placeholder?: string
}) {
    const [keyword, setKeyword] = useState('')
    const [results, setResults] = useState<Array<{ code: string; name: string }>>([])
    const timer = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        clearTimeout(timer.current)
        if (!keyword.trim()) {
            setResults([])
            return
        }
        timer.current = setTimeout(() => {
            window.api.market
                .search(keyword.trim())
                .then((r) => setResults(r.slice(0, 8)))
                .catch(() => setResults([]))
        }, 250)
        return () => clearTimeout(timer.current)
    }, [keyword])

    return (
        <div className="alert-picker">
            <input className="input" placeholder={placeholder} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            {results.length > 0 && (
                <div className="alert-picker-dropdown">
                    {results.map((r) => (
                        <button
                            key={r.code}
                            onClick={() => {
                                onPick(r)
                                setKeyword('')
                                setResults([])
                            }}
                        >
                            <span>{r.name}</span>
                            <span className="dash-muted">{r.code}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
