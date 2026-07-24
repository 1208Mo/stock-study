/**
 * 会话与消息的前端状态。
 * - sessions: 全量会话元数据（左侧列表用）
 * - activeSessionId: 当前打开的会话
 * - messagesBySession: 每个会话的展示消息缓存
 *
 * 后端权威数据在 sqlite 里：
 *   chat_sessions（元数据）+ chat_messages（UI 展示消息）+ chat_checkpoints/writes（Agent 状态）
 */
import { create } from 'zustand'
import type { ChatSessionMeta, ChatMessageRow, ResearchToolTrace } from '../types'

export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
    pending?: boolean
    stopped?: boolean
    toolCalls?: ResearchToolTrace[]
}

interface ChatSessionsState {
    sessions: ChatSessionMeta[]
    activeSessionId: string | null
    messagesBySession: Record<string, ChatMessage[]>
    loaded: boolean

    loadSessions: () => Promise<void>
    setActive: (id: string) => Promise<void>
    createSession: () => Promise<string>
    renameSession: (id: string, title: string) => Promise<void>
    deleteSession: (id: string) => Promise<void>
    loadMessages: (sessionId: string) => Promise<void>

    // 消息编辑（本地状态操作，不落库；落库交给主进程）
    appendMessage: (sessionId: string, msg: ChatMessage) => void
    updatePendingMessage: (sessionId: string, mutator: (msg: ChatMessage) => ChatMessage) => void
    finalizePendingMessage: (
        sessionId: string,
        mutator: (msg: ChatMessage) => ChatMessage
    ) => void
    replaceMessages: (sessionId: string, messages: ChatMessage[]) => void
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
    let toolCalls: ResearchToolTrace[] | undefined
    if (row.tool_calls) {
        try {
            toolCalls = JSON.parse(row.tool_calls) as ResearchToolTrace[]
        } catch {
            /* ignore */
        }
    }
    return {
        role: row.role === 'user' ? 'user' : 'assistant',
        content: row.content,
        toolCalls,
    }
}

export const useChatSessionsStore = create<ChatSessionsState>((set, get) => ({
    sessions: [],
    activeSessionId: null,
    messagesBySession: {},
    loaded: false,

    loadSessions: async () => {
        try {
            const sessions = await window.api.chat.listSessions()
            set({ sessions, loaded: true })
            // 默认选中最近一条；若空则自动新建一条以便进入即可用
            if (sessions.length > 0) {
                await get().setActive(sessions[0].id)
            } else {
                const id = await get().createSession()
                await get().setActive(id)
            }
        } catch (e) {
            console.error('Failed to load chat sessions:', e)
            set({ loaded: true })
        }
    },

    setActive: async (id) => {
        set({ activeSessionId: id })
        if (!get().messagesBySession[id]) {
            await get().loadMessages(id)
        }
    },

    createSession: async () => {
        const meta = await window.api.chat.createSession()
        set((s) => ({
            sessions: [meta, ...s.sessions],
            activeSessionId: meta.id,
            messagesBySession: { ...s.messagesBySession, [meta.id]: [] },
        }))
        return meta.id
    },

    renameSession: async (id, title) => {
        await window.api.chat.renameSession(id, title)
        set((s) => ({
            sessions: s.sessions.map((sess) =>
                sess.id === id ? { ...sess, title } : sess
            ),
        }))
    },

    deleteSession: async (id) => {
        await window.api.chat.deleteSession(id)
        set((s) => {
            const nextSessions = s.sessions.filter((sess) => sess.id !== id)
            const nextMsgs = { ...s.messagesBySession }
            delete nextMsgs[id]
            const nextActive =
                s.activeSessionId === id
                    ? nextSessions[0]?.id ?? null
                    : s.activeSessionId
            return {
                sessions: nextSessions,
                activeSessionId: nextActive,
                messagesBySession: nextMsgs,
            }
        })
        // 如果全删空了，自动补一个
        if (get().sessions.length === 0) {
            const newId = await get().createSession()
            await get().setActive(newId)
        }
    },

    loadMessages: async (sessionId) => {
        try {
            const rows = await window.api.chat.getMessages(sessionId)
            const messages = rows.map(rowToMessage)
            set((s) => ({
                messagesBySession: { ...s.messagesBySession, [sessionId]: messages },
            }))
        } catch (e) {
            console.error('Failed to load chat messages:', e)
        }
    },

    appendMessage: (sessionId, msg) =>
        set((s) => ({
            messagesBySession: {
                ...s.messagesBySession,
                [sessionId]: [...(s.messagesBySession[sessionId] ?? []), msg],
            },
        })),

    updatePendingMessage: (sessionId, mutator) =>
        set((s) => {
            const list = s.messagesBySession[sessionId] ?? []
            const idx = [...list].reverse().findIndex((m) => m.pending && m.role === 'assistant')
            if (idx === -1) return {}
            const realIdx = list.length - 1 - idx
            const next = [...list]
            next[realIdx] = mutator(next[realIdx])
            return {
                messagesBySession: { ...s.messagesBySession, [sessionId]: next },
            }
        }),

    finalizePendingMessage: (sessionId, mutator) =>
        set((s) => {
            const list = s.messagesBySession[sessionId] ?? []
            const next = list.map((m) =>
                m.pending && m.role === 'assistant' ? mutator(m) : m
            )
            return {
                messagesBySession: { ...s.messagesBySession, [sessionId]: next },
            }
        }),

    replaceMessages: (sessionId, messages) =>
        set((s) => ({
            messagesBySession: { ...s.messagesBySession, [sessionId]: messages },
        })),
}))
