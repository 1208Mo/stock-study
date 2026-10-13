import { useCallback, useEffect, useRef, useState } from 'react'

/** 全局“手动刷新”事件：Cmd/Ctrl+R 触发，所有轮询数据与各页面监听后立即补拉一次 */
export const APP_REFRESH_EVENT = 'app:refresh'

interface PollingState<T> {
    data: T | null
    error: string | null
    loading: boolean
    refresh: () => void
}

/**
 * 定时拉取数据。窗口不可见时暂停，重新可见时立即补拉一次。
 * 失败时保留上一次成功的数据，只更新 error。
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number): PollingState<T> {
    const [data, setData] = useState<T | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const fetcherRef = useRef(fetcher)
    fetcherRef.current = fetcher
    const aliveRef = useRef(true)

    const run = useCallback(() => {
        fetcherRef
            .current()
            .then((value) => {
                if (!aliveRef.current) return
                setData(value)
                setError(null)
            })
            .catch((e) => {
                if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
            })
            .finally(() => {
                if (aliveRef.current) setLoading(false)
            })
    }, [])

    useEffect(() => {
        aliveRef.current = true
        run()
        const timer = setInterval(() => {
            if (!document.hidden) run()
        }, intervalMs)
        const onVisible = () => {
            if (!document.hidden) run()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener(APP_REFRESH_EVENT, run)
        return () => {
            aliveRef.current = false
            clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener(APP_REFRESH_EVENT, run)
        }
    }, [intervalMs, run])

    return { data, error, loading, refresh: run }
}
