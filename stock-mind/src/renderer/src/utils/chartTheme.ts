// 图表主题助手：从当前主题的 CSS 变量读取颜色，让 ECharts 随主题切换保持可读
// ECharts option 不能直接吃 CSS 变量字符串，这里读取计算后的实际色值。
// 配合 useChartTheme + 'themechange' 事件，切换主题时图表可即时重新上色。
import { useEffect, useState } from 'react'

export interface ChartTheme {
    axis: string // 坐标轴文字
    axisLine: string // 坐标轴线
    split: string // 分隔网格线
    text: string // 普通文字（tooltip/label）
    up: string // 涨（红）
    down: string // 跌（绿）
}

export function getChartTheme(): ChartTheme {
    const s = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => {
        const val = s.getPropertyValue(name).trim()
        return val || fallback
    }
    return {
        axis: v('--text-muted', '#9ca3af'),
        axisLine: v('--border', '#2a2d3e'),
        split: v('--border-light', '#252836'),
        text: v('--text', '#d1d5db'),
        up: v('--up', '#ef5350'),
        down: v('--down', '#26a69a'),
    }
}

// 主题切换事件名：Settings 切换主题后 dispatch，图表订阅后即时重算颜色
export const THEME_CHANGE_EVENT = 'themechange'

// React 钩子：返回当前图表主题，并在主题切换时触发组件重渲染
export function useChartTheme(): ChartTheme {
    const [theme, setTheme] = useState<ChartTheme>(getChartTheme)
    useEffect(() => {
        const handler = () => setTheme(getChartTheme())
        window.addEventListener(THEME_CHANGE_EVENT, handler)
        return () => window.removeEventListener(THEME_CHANGE_EVENT, handler)
    }, [])
    return theme
}
