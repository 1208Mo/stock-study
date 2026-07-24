import { useState } from 'react'
import { useChatSessionsStore } from '../stores/chatSessionsStore'

export function ChatSidebar() {
    const sessions = useChatSessionsStore((s) => s.sessions)
    const activeId = useChatSessionsStore((s) => s.activeSessionId)
    const setActive = useChatSessionsStore((s) => s.setActive)
    const createSession = useChatSessionsStore((s) => s.createSession)
    const renameSession = useChatSessionsStore((s) => s.renameSession)
    const deleteSession = useChatSessionsStore((s) => s.deleteSession)

    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingTitle, setEditingTitle] = useState('')

    async function handleNew() {
        const id = await createSession()
        await setActive(id)
    }

    function startRename(id: string, currentTitle: string) {
        setEditingId(id)
        setEditingTitle(currentTitle)
    }

    async function commitRename() {
        if (editingId && editingTitle.trim()) {
            await renameSession(editingId, editingTitle.trim())
        }
        setEditingId(null)
        setEditingTitle('')
    }

    async function handleDelete(id: string) {
        if (!confirm('确定删除这个会话？相关聊天记录和 Agent 状态都会一起删除。')) return
        await deleteSession(id)
    }

    return (
        <aside className="chat-sidebar" aria-label="会话列表">
            <div className="chat-sidebar-header">
                <div className="chat-sidebar-title">对话</div>
                <button className="chat-sidebar-new" onClick={handleNew} title="新建对话">
                    + 新对话
                </button>
            </div>
            <div className="chat-sidebar-list">
                {sessions.length === 0 && (
                    <div className="chat-sidebar-empty">还没有对话</div>
                )}
                {sessions.map((s) => (
                    <div
                        key={s.id}
                        className={`chat-sidebar-item${s.id === activeId ? ' active' : ''}`}
                        onClick={() => {
                            if (editingId !== s.id) setActive(s.id)
                        }}
                    >
                        {editingId === s.id ? (
                            <input
                                autoFocus
                                className="chat-sidebar-item-title"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitRename()
                                    if (e.key === 'Escape') {
                                        setEditingId(null)
                                        setEditingTitle('')
                                    }
                                }}
                                style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 4,
                                    padding: '2px 4px',
                                    fontSize: 13,
                                    outline: 'none',
                                }}
                            />
                        ) : (
                            <span className="chat-sidebar-item-title" title={s.title}>
                                {s.title || '新对话'}
                            </span>
                        )}
                        <div className="chat-sidebar-item-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                                className="chat-sidebar-item-btn"
                                onClick={() => startRename(s.id, s.title)}
                                title="重命名"
                            >
                                改
                            </button>
                            <button
                                className="chat-sidebar-item-btn"
                                onClick={() => handleDelete(s.id)}
                                title="删除"
                            >
                                删
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    )
}
