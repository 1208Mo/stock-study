import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChatSidebar } from '../components/ChatSidebar'
import { useChatSessionsStore, type ChatMessage } from '../stores/chatSessionsStore'
import type { ResearchToolTrace, ImageContent } from '../types'

const SUGGESTIONS = [
    '今天有哪些强势股值得关注？',
    '帮我分析一下今日市场热点板块',
    '推荐几只近期可能大涨的股票',
    '今天哪些股票出现了买入信号？',
    '近期涨停股有哪些？帮我分析一下',
    '哪些个股处于低位即将启动？',
    '帮我看看哪些股票放量上涨了',
    '今天有什么短线机会？',
]

const SCROLL_THRESHOLD = 120 // px：距底部这么近才自动跟随

const MessageBubble = memo(function MessageBubble({
    msg,
    onCopy,
    onRegenerate,
    onFeedback,
    analyzingMessage,
}: {
    msg: ChatMessage
    onCopy: (content: string) => void
    onRegenerate: (content: string) => void
    onFeedback: (content: string, type: 'positive' | 'negative') => void
    analyzingMessage?: string | null
}) {
    const isAssistant = msg.role === 'assistant'
    const isStreaming = !!msg.pending && isAssistant
    const isEmptyStreaming = isStreaming && msg.content === ''

    const hasImages = msg.images && msg.images.length > 0

    return (
        <div className={`chat-bubble-wrap ${msg.role}`}>
            {isAssistant && (
                <div className="chat-avatar chat-avatar-ai" aria-hidden="true">
                    AI
                </div>
            )}
            <div className="chat-bubble-col">
                <div
                    className={`chat-bubble ${msg.role}${
                        isStreaming ? ' streaming' : ''
                    }${msg.stopped ? ' stopped' : ''}`}
                >
                    {!isAssistant && hasImages && (
                        <div className="chat-images-container">
                            {msg.images!.map((img) => (
                                <img
                                    key={img.id}
                                    src={img.dataUrl}
                                    alt={img.name}
                                    className="chat-image"
                                    onClick={() => window.open(img.dataUrl)}
                                />
                            ))}
                        </div>
                    )}
                    {isAssistant ? (
                        isEmptyStreaming ? (
                            <div className="chat-loading" aria-label={analyzingMessage || 'AI 正在思考'}>
                                {analyzingMessage ? (
                                    <div className="chat-analyzing-message">
                                        <span className="chat-dot" />
                                        <span>{analyzingMessage}</span>
                                    </div>
                                ) : (
                                    <>
                                        <span className="chat-dot" />
                                        <span className="chat-dot" />
                                        <span className="chat-dot" />
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="markdown-body chat-markdown">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {msg.content}
                                </ReactMarkdown>
                                {isStreaming && <span className="chat-caret" aria-hidden="true" />}
                                {msg.stopped && (
                                    <div className="chat-stopped-note">— 已停止生成</div>
                                )}
                            </div>
                        )
                    ) : (
                        msg.content ? <span>{msg.content}</span> : null
                    )}
                </div>

                {isAssistant && !isEmptyStreaming && !isStreaming && (
                    <div className="chat-msg-actions" role="group" aria-label="消息操作">
                        <button
                            type="button"
                            className="chat-msg-action"
                            onClick={() => onRegenerate(msg.content)}
                            aria-label="重新生成"
                            title="重新生成"
                        >
                            🔄 重新生成
                        </button>
                        <button
                            type="button"
                            className="chat-msg-action chat-feedback-btn positive"
                            onClick={() => onFeedback(msg.content, 'positive')}
                            aria-label="有用"
                            title="这个回答很有帮助"
                        >
                            👍
                        </button>
                        <button
                            type="button"
                            className="chat-msg-action chat-feedback-btn negative"
                            onClick={() => onFeedback(msg.content, 'negative')}
                            aria-label="没用"
                            title="这个回答没有帮助"
                        >
                            👎
                        </button>
                        <button
                            type="button"
                            className="chat-msg-action"
                            onClick={() => onCopy(msg.content)}
                            aria-label="复制"
                            title="复制"
                        >
                            📋 复制
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
})

export default function AIChat() {
    const loaded = useChatSessionsStore((s) => s.loaded)
    const loadSessions = useChatSessionsStore((s) => s.loadSessions)
    const activeSessionId = useChatSessionsStore((s) => s.activeSessionId)
    const messages = useChatSessionsStore((s) =>
        s.activeSessionId ? s.messagesBySession[s.activeSessionId] ?? [] : []
    )
    const appendMessage = useChatSessionsStore((s) => s.appendMessage)
    const updatePendingMessage = useChatSessionsStore((s) => s.updatePendingMessage)
    const finalizePendingMessage = useChatSessionsStore((s) => s.finalizePendingMessage)
    const replaceMessages = useChatSessionsStore((s) => s.replaceMessages)

    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState('')
    const [toastMessage, setToastMessage] = useState<string | null>(null)
    const [selectedImages, setSelectedImages] = useState<ImageContent[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [analyzingMessage, setAnalyzingMessage] = useState<string | null>(null)
    const messagesRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const textareaMinHeight = 44
    const textareaMaxHeight = 160
    const activeRequestIdRef = useRef<string | null>(null)
    const isNearBottomRef = useRef(true)
    const dragCounterRef = useRef(0)

    // 首次挂载时加载会话
    useEffect(() => {
        if (!loaded) {
            void loadSessions()
        }
    }, [loaded, loadSessions])

    // 切换会话时清掉输入框和错误提示
    useEffect(() => {
        setInput('')
        setError('')
        isNearBottomRef.current = true
    }, [activeSessionId])

    // 智能自动滚动：只有当用户接近底部时才跟随
    useLayoutEffect(() => {
        const el = messagesRef.current
        if (!el) return
        if (isNearBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])

    // 监听滚动，记录是否接近底部
    useEffect(() => {
        const el = messagesRef.current
        if (!el) return
        const handler = () => {
            const distance = el.scrollHeight - el.scrollTop - el.clientHeight
            isNearBottomRef.current = distance < SCROLL_THRESHOLD
        }
        handler()
        el.addEventListener('scroll', handler, { passive: true })
        return () => el.removeEventListener('scroll', handler)
    }, [])

    // textarea 自动增高
    useEffect(() => {
        const ta = inputRef.current
        if (!ta) return
        ta.style.height = 'auto'
        const next = Math.min(Math.max(ta.scrollHeight, textareaMinHeight), textareaMaxHeight)
        ta.style.height = `${next}px`
    }, [input])

    const doSend = useCallback(
        (content: string, images?: ImageContent[]): void => {
            const sessionId = activeSessionId
            if ((!content.trim() && (!images || images.length === 0)) || !sessionId || sending) return
            setError('')
            setAnalyzingMessage(null)

            const trimmed = content.trim()
            appendMessage(sessionId, { role: 'user', content: trimmed, images })
            appendMessage(sessionId, { role: 'assistant', content: '', pending: true })
            setSending(true)
            isNearBottomRef.current = true

            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
            activeRequestIdRef.current = requestId

            const offChunk = window.api.ai.onChatChunk(({ requestId: rid, chunk }) => {
                if (rid !== requestId) return
                updatePendingMessage(sessionId, (msg) => ({
                    ...msg,
                    content: msg.content + chunk,
                }))
            })

            const offAnalyzing = window.api.ai.onChatAnalyzing(({ requestId: rid, message }) => {
                if (rid !== requestId) return
                setAnalyzingMessage(message)
            })

            const cleanup = () => {
                offChunk()
                offDone()
                offError()
                offAnalyzing()
                activeRequestIdRef.current = null
                setAnalyzingMessage(null)
            }

            const offDone = window.api.ai.onChatDone(({ requestId: rid, toolCalls, aborted }) => {
                if (rid !== requestId) return
                cleanup()
                setSending(false)
                finalizePendingMessage(sessionId, (msg) => ({
                    role: 'assistant',
                    content: msg.content,
                    stopped: !!aborted,
                    toolCalls: toolCalls as ResearchToolTrace[],
                }))
                inputRef.current?.focus()
            })

            const offError = window.api.ai.onChatError(({ requestId: rid, error: errMsg }) => {
                if (rid !== requestId) return
                cleanup()
                setSending(false)
                setError(errMsg)
                // 回退：去掉本轮 user + pending assistant
                const cur =
                    useChatSessionsStore.getState().messagesBySession[sessionId] ?? []
                replaceMessages(sessionId, cur.slice(0, -2))
                inputRef.current?.focus()
            })

            window.api.ai.chatStream({ sessionId, input: trimmed, images }, requestId)
        },
        [
            activeSessionId,
            sending,
            appendMessage,
            updatePendingMessage,
            finalizePendingMessage,
            replaceMessages,
        ]
    )

    function handleSend(text?: string) {
        const content = (text ?? input).trim()
        if (!content && selectedImages.length === 0) return
        setInput('')
        const images = selectedImages.length > 0 ? [...selectedImages] : undefined
        setSelectedImages([])
        doSend(content, images)
    }

    function handleStop() {
        const rid = activeRequestIdRef.current
        if (rid) window.api.ai.chatStop(rid)
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    // 粘贴图片处理
    const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items
        if (!items || items.length === 0) return

        const imageFiles: File[] = []
        for (const item of Array.from(items)) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile()
                if (file) imageFiles.push(file)
            }
        }

        if (imageFiles.length > 0) {
            e.preventDefault()
            await addImagesFromFiles(imageFiles)
        }
    }, [])

    // 拖拽事件处理
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounterRef.current++
        if (e.dataTransfer.items && Array.from(e.dataTransfer.items).some(i => i.kind === 'file' && i.type.startsWith('image/'))) {
            setIsDragging(true)
        }
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounterRef.current--
        if (dragCounterRef.current === 0) {
            setIsDragging(false)
        }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        dragCounterRef.current = 0

        const files: File[] = []
        // 优先从 items 获取
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            for (const item of Array.from(e.dataTransfer.items)) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile()
                    if (file) files.push(file)
                }
            }
        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            for (const file of Array.from(e.dataTransfer.files)) {
                if (file.type.startsWith('image/')) {
                    files.push(file)
                }
            }
        }

        if (files.length > 0) {
            await addImagesFromFiles(files)
        }
    }, [])

    // 统一的添加图片处理
    const addImagesFromFiles = useCallback(async (files: File[]) => {
        const newImages: ImageContent[] = []
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue
            if (file.size > 10 * 1024 * 1024) {
                setToastMessage(`${file.name || '图片'} 超过10MB限制`)
                window.setTimeout(() => setToastMessage(null), 2000)
                continue
            }
            const dataUrl = await fileToDataUrl(file)
            newImages.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                dataUrl,
                name: file.name || `粘贴的图片`,
                type: file.type,
            })
        }

        if (newImages.length > 0) {
            setSelectedImages((prev) => [...prev, ...newImages])
            setToastMessage(`已添加 ${newImages.length} 张图片`)
            window.setTimeout(() => setToastMessage(null), 1500)
        }
    }, [])

    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (!files || files.length === 0) return
        await addImagesFromFiles(Array.from(files))
        // 清空 input
        e.target.value = ''
    }

    function fileToDataUrl(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
        })
    }

    function removeImage(id: string) {
        setSelectedImages((prev) => prev.filter((img) => img.id !== id))
    }

    async function handleCopy(content: string) {
        try {
            await navigator.clipboard.writeText(content)
            setToastMessage('已复制到剪贴板')
            window.setTimeout(() => setToastMessage(null), 1200)
        } catch {
            // ignore
        }
    }

    function handleRegenerate(content: string) {
        // 重新生成逻辑：移除最后一条消息，重新发送上一条用户消息
        const list = useChatSessionsStore.getState().messagesBySession[activeSessionId ?? ''] ?? []
        if (list.length >= 2) {
            const userMsg = list[list.length - 2]
            if (userMsg && userMsg.role === 'user') {
                // 移除最后一条助手消息
                replaceMessages(activeSessionId ?? '', list.slice(0, -1))
                // 重新发送用户消息（包括图片）
                doSend(userMsg.content, userMsg.images)
            }
        }
    }

    async function handleFeedback(content: string, type: 'positive' | 'negative') {
        try {
            // 简单的反馈收集
            console.log('Feedback:', type, content)
            // 可以扩展为发送到后端或本地存储
            setToastMessage(type === 'positive' ? '感谢反馈！' : '收到，我们会改进')
            window.setTimeout(() => setToastMessage(null), 2000)
        } catch {
            // ignore
        }
    }

    function handleRetry() {
        const list = useChatSessionsStore.getState().messagesBySession[activeSessionId ?? ''] ?? []
        const last = list[list.length - 1]
        if (last && last.role === 'user') {
            // 出错时我们已经回退掉了 user，这个分支实际上走不到
            doSend(last.content)
        }
    }

    return (
        <div className="chat-layout">
            <ChatSidebar />
            <div className="chat-page">
                <div className="page-header">
                    <div>
                        <h1 className="page-title">AI 炒股助手</h1>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            可以询问个股分析、板块逻辑、技术指标、操作策略等问题
                        </p>
                    </div>
                </div>

                <div
                    className="chat-messages"
                    ref={messagesRef}
                    role="log"
                    aria-live="polite"
                    aria-relevant="additions text"
                >
                    {activeSessionId && messages.length === 0 && (
                        <div className="chat-welcome">
                            <div className="chat-welcome-title">你好，我是 AI 炒股助手</div>
                            <p>你可以问我任何关于 A 股的问题，例如：</p>
                            <div className="chat-suggestions">
                                {SUGGESTIONS.map((s, i) => (
                                    <button
                                        key={s}
                                        className="chat-suggestion-btn"
                                        style={{ animationDelay: `${i * 60}ms` }}
                                        onClick={() => handleSend(s)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <MessageBubble
                            key={i}
                            msg={msg}
                            onCopy={handleCopy}
                            onRegenerate={handleRegenerate}
                            onFeedback={handleFeedback}
                            analyzingMessage={i === messages.length - 1 && msg.role === 'assistant' && msg.pending ? analyzingMessage : null}
                        />
                    ))}
                    {error && (
                        <div className="chat-bubble-wrap assistant">
                            <div className="chat-avatar chat-avatar-ai" aria-hidden="true">
                                !
                            </div>
                            <div className="chat-bubble-col">
                                <div
                                    className="chat-bubble assistant chat-bubble-error"
                                    role="alert"
                                >
                                    <div>{error}</div>
                                    <button
                                        type="button"
                                        className="chat-msg-action"
                                        style={{ marginTop: 6 }}
                                        onClick={handleRetry}
                                    >
                                        重试
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>

                {/* 屏幕阅读器实时提示 */}
                <div role="status" aria-live="polite" className="sr-only">
                    {sending ? 'AI 正在回复' : ''}
                </div>

                <div
                    className={`chat-input-area${isDragging ? ' dragging' : ''}`}
                    onPaste={handlePaste}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                >
                    {isDragging && (
                        <div className="chat-drop-overlay" aria-hidden="true">
                            <div className="chat-drop-overlay-content">
                                <span className="chat-drop-icon">📸</span>
                                <span>松开上传图片</span>
                            </div>
                        </div>
                    )}
                    {selectedImages.length > 0 && (
                        <div className="chat-image-preview-bar">
                            {selectedImages.map((img) => (
                                <div key={img.id} className="chat-image-preview-item">
                                    <img src={img.dataUrl} alt={img.name} />
                                    <button
                                        type="button"
                                        className="chat-image-remove"
                                        onClick={() => removeImage(img.id)}
                                        aria-label={`移除 ${img.name}`}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="chat-input-bar">
                        <button
                            type="button"
                            className="chat-image-upload-btn"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={sending || !activeSessionId}
                            aria-label="上传图片"
                            title="上传图片"
                        >
                            📎
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: 'none' }}
                            onChange={handleFileSelect}
                            disabled={sending}
                        />
                        <textarea
                            ref={inputRef}
                            className="chat-input"
                            rows={1}
                            placeholder={selectedImages.length > 0 ? '添加文字说明...' : '输入问题，Enter 发送，Shift+Enter 换行，支持粘贴/拖拽图片'}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={sending || !activeSessionId}
                        />
                        {sending ? (
                            <button
                                type="button"
                                className="btn-primary chat-send-btn chat-stop-btn"
                                onClick={handleStop}
                                aria-label="停止生成"
                            >
                                停止
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="btn-primary chat-send-btn"
                                onClick={() => handleSend()}
                                disabled={(!input.trim() && selectedImages.length === 0) || !activeSessionId}
                                aria-label="发送"
                            >
                                发送
                            </button>
                        )}
                    </div>
                </div>

                <div className="disclaimer-box" style={{ marginTop: 8 }}>
                    AI 回答仅供参考，不构成投资建议。股市有风险，投资需谨慎。
                </div>

                {toastMessage && <div className="chat-toast">{toastMessage}</div>}
            </div>
        </div>
    )
}
