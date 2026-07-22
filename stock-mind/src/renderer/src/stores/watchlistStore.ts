import { create } from 'zustand'
import type { WatchItem, QuoteData } from '../types'

interface WatchlistState {
    items: WatchItem[]
    quotes: Map<string, QuoteData>
    groups: string[] // 自定义分组列表
    itemGroups: Map<number, string> // itemId -> groupName
    loading: boolean
    fetchWatchlist: () => Promise<void>
    refreshWatchlistQuotes: () => Promise<void>
    addItem: (code: string, name: string, note?: string) => Promise<void>
    removeItem: (id: number) => Promise<void>
    search: (keyword: string) => Promise<{ code: string; name: string }[]>
    addGroup: (name: string) => void
    removeGroup: (name: string) => void
    setItemGroup: (id: number, group: string) => void
}

const GROUPS_KEY = 'watchlist_groups'
const ITEM_GROUPS_KEY = 'watchlist_item_groups'

function loadGroups(): string[] {
    try {
        return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]')
    } catch {
        return []
    }
}
function saveGroups(groups: string[]) {
    try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify(groups))
    } catch {}
}
function loadItemGroups(): Map<number, string> {
    try {
        return new Map(
            Object.entries(JSON.parse(localStorage.getItem(ITEM_GROUPS_KEY) ?? '{}')).map(
                ([k, v]) => [parseInt(k), v as string]
            )
        )
    } catch {
        return new Map()
    }
}
function saveItemGroups(m: Map<number, string>) {
    try {
        localStorage.setItem(ITEM_GROUPS_KEY, JSON.stringify(Object.fromEntries(m)))
    } catch {}
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
    items: [],
    quotes: new Map(),
    groups: loadGroups(),
    itemGroups: loadItemGroups(),
    loading: false,

    fetchWatchlist: async () => {
        set({ loading: true })
        try {
            const items = await window.api.watchlist.getAll()
            set({ items, loading: false })
            get().refreshWatchlistQuotes()
        } catch (e) {
            console.error(e)
            set({ loading: false })
        }
    },

    refreshWatchlistQuotes: async () => {
        const { items } = get()
        if (items.length === 0) return
        try {
            const codes = items.map((i) => i.code)
            const quotes = await window.api.market.getBatchQuotes(codes)
            const map = new Map(quotes.map((q) => [q.code, q]))
            set({ quotes: map })
        } catch (e) {
            console.error('Failed to refresh watchlist quotes:', e)
        }
    },

    addItem: async (code, name, note) => {
        await window.api.watchlist.add(code, name, note)
        await get().fetchWatchlist()
    },

    removeItem: async (id) => {
        await window.api.watchlist.remove(id)
        await get().fetchWatchlist()
    },

    search: async (keyword) => {
        return window.api.market.search(keyword)
    },

    addGroup: (name) => {
        const groups = [...get().groups.filter((g) => g !== name), name]
        saveGroups(groups)
        set({ groups })
    },

    removeGroup: (name) => {
        const groups = get().groups.filter((g) => g !== name)
        const itemGroups = new Map(get().itemGroups)
        for (const [k, v] of itemGroups.entries()) {
            if (v === name) itemGroups.delete(k)
        }
        saveGroups(groups)
        saveItemGroups(itemGroups)
        set({ groups, itemGroups })
    },

    setItemGroup: (id, group) => {
        const itemGroups = new Map(get().itemGroups)
        if (group === '') {
            itemGroups.delete(id)
        } else {
            itemGroups.set(id, group)
        }
        saveItemGroups(itemGroups)
        set({ itemGroups })
    },
}))
