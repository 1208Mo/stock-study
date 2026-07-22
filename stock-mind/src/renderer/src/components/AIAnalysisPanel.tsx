import ReactMarkdown from 'react-markdown'

interface Props {
    content: string
    isLatest?: boolean
    createdAt?: string
    model?: string
}

export default function AIAnalysisPanel({ content, isLatest, createdAt, model }: Props) {
    const formattedTime = createdAt
        ? new Date(createdAt).toLocaleString('zh-CN', { hour12: false })
        : null

    return (
        <div className={`analysis-panel ${isLatest ? 'latest' : ''}`}>
            <div className="analysis-meta">
                {isLatest && <span className="badge-latest">最新</span>}
                {model && <span className="badge-model">{model}</span>}
                {formattedTime && <span className="analysis-time">{formattedTime}</span>}
            </div>
            <div className="analysis-content markdown-body">
                <ReactMarkdown>{content}</ReactMarkdown>
            </div>
            <p className="analysis-disclaimer">仅供参考，不构成投资建议</p>
        </div>
    )
}
