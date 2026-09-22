import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
    children: ReactNode
    /** 边界标签，便于区分是哪块出错 */
    label?: string
}

interface State {
    error: Error | null
}

// 渲染错误边界：捕获子树渲染异常，避免整个应用白/黑屏，并把错误显示出来便于定位
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info)
    }

    handleReset = () => this.setState({ error: null })

    render() {
        const { error } = this.state
        if (error) {
            return (
                <div className="error-boundary">
                    <h2>页面出错了</h2>
                    <p className="error-boundary-msg">{error.message}</p>
                    {error.stack && (
                        <pre className="error-boundary-stack">{error.stack}</pre>
                    )}
                    <button className="btn-secondary" onClick={this.handleReset}>
                        重试
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}
