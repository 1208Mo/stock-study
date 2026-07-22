import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'

interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
    // 正在流式接收时为 true，用于显示 loading 态
    pending?: boolean
}

const SUGGESTIONS = [
    '中国平安现在还能买吗？',
    '510300 沪深300ETF适合定投吗？',
    '今天大盘走势如何判断？',
    '什么情况下该止损？',
    '如何看均线多头排列？',
    '半导体板块的核心逻辑是什么？',
]

const HISTORY_KEY = 'ai_chat_history'

function loadHistory(): ChatMessage[] {
    try {
        // 历史里不保留 pending 状态
        const raw: ChatMessage[] = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
        return raw.map(({ role, content }) => ({ role, content }))
    } catch {
        return []
    }
}
function saveHistory(msgs: ChatMessage[]) {
    try {
        const cleaned = msgs
            .filter((m) => !m.pending)
            .map(({ role, content }) => ({ role, content }))
        localStorage.setItem(HISTORY_KEY, JSON.stringify(cleaned.slice(-60)))
    } catch {}
}

export default function AIChat() {
    const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory())
    const [input, setInput] = useState('')
    // 是否有任何一条消息还在接收中，只用来控制输入框禁用
    const [sending, setSending] = useState(false)
    const [error, setError] = useState('')
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    async function handleSend(text?: string) {
        const content = (text ?? input).trim()
        if (!content || sending) return
        setInput('')
        setError('')

        const userMsg: ChatMessage = { role: 'user', content }
        // 当前 messages 是历史（不含本轮），连同 userMsg 作为本轮上下文
        const historyForAgent = [...messages, userMsg]

        // 更新界面：加上用户消息 + 空的 pending assistant 占位
        setMessages([...historyForAgent, { role: 'assistant', content: '', pending: true }])
        setSending(true)

        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

        const offChunk = window.api.ai.onChatChunk(({ requestId: rid, chunk }) => {
            if (rid !== requestId) return
            setMessages((prev) => {
                const next = [...prev]
                const idx = next.findLastIndex((m) => m.pending && m.role === 'assistant')
                if (idx === -1) return prev
                next[idx] = { ...next[idx], content: next[idx].content + chunk }
                return next
            })
        })

        const offDone = window.api.ai.onChatDone(({ requestId: rid }) => {
            if (rid !== requestId) return
            cleanup()
            setSending(false)
            setMessages((prev) => {
                const next = prev.map((m) =>
                    m.pending && m.role === 'assistant'
                        ? { role: 'assistant' as const, content: m.content }
                        : m
                )
                saveHistory(next)
                return next
            })
            inputRef.current?.focus()
        })

        const offError = window.api.ai.onChatError(({ requestId: rid, error: errMsg }) => {
            if (rid !== requestId) return
            cleanup()
            setError(errMsg)
            // 回退到发送前的状态（去掉本轮 user + pending assistant）
            setMessages(messages)
            setSending(false)
            inputRef.current?.focus()
        })

        function cleanup() {
            offChunk()
            offDone()
            offError()
        }

        window.api.ai.chatStream(
            { messages: historyForAgent.map((m) => ({ role: m.role, content: m.content })) },
            requestId
        )
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    function handleClear() {
        setMessages([])
        saveHistory([])
        setError('')
    }

    return (
        <div className="chat-page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">AI 炒股助手</h1>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        可以询问个股分析、板块逻辑、技术指标、操作策略等问题
                    </p>
                </div>
                {messages.length > 0 && (
                    <button className="btn-small" style={{ color: '#888' }} onClick={handleClear}>
                        清空对话
                    </button>
                )}
            </div>

            <div className="chat-messages">
                {messages.length === 0 && (
                    <div className="chat-welcome">
                        <div className="chat-welcome-title">你好，我是 AI 炒股助手</div>
                        <p>你可以问我任何关于 A 股的问题，例如：</p>
                        <div className="chat-suggestions">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s}
                                    className="chat-suggestion-btn"
                                    onClick={() => handleSend(s)}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`chat-bubble-wrap ${msg.role}`}>
                        <div className={`chat-bubble ${msg.role}`}>
                            {msg.role === 'assistant' ? (
                                msg.pending && msg.content === '' ? (
                                    // 正在等待第一个 chunk：显示 loading 动画
                                    <div className="chat-loading">
                                        <span className="chat-dot" />
                                        <span className="chat-dot" />
                                        <span className="chat-dot" />
                                    </div>
                                ) : (
                                    <div className="markdown-body chat-markdown">
                                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    </div>
                                )
                            ) : (
                                <span>{msg.content}</span>
                            )}
                        </div>
                    </div>
                ))}
                {error && (
                    <div className="chat-bubble-wrap assistant">
                        <div className="chat-bubble assistant" style={{ color: 'var(--danger)' }}>
                            {error}
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <div className="chat-input-bar">
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    rows={2}
                    placeholder="输入问题，Enter 发送，Shift+Enter 换行..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                />
                <button
                    className="btn-primary chat-send-btn"
                    onClick={() => handleSend()}
                    disabled={sending || !input.trim()}
                >
                    {sending ? '...' : '发送'}
                </button>
            </div>

            <div className="disclaimer-box" style={{ marginTop: 8 }}>
                AI 回答仅供参考，不构成投资建议。股市有风险，投资需谨慎。
            </div>
        </div>
    )
}
