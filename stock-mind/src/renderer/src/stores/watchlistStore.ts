import { create } from 'zustand'
import type { WatchItem, QuoteData } from '../types'

interface WatchlistState {
    items: WatchItem[]
    quotes: Map<string, QuoteData>
    groups: string[]
    itemGroups: Map<number, string>
    loading: boolean
    fetchWatchlist: () => Promise<void>
    refreshWatchlistQuotes: () => Promise<void>
    addItem: (code: string, name: string, note?: string) => Promise<void>
    removeItem: (id: number) => Promise<void>
    search: (keyword: string) => Promise<{ code: string; name: string }[]>
    addGroup: (name: string) => Promise<void>
    removeGroup: (name: string) => Promise<void>
    setItemGroup: (id: number, group: string) => Promise<void>
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
    items: [],
    quotes: new Map(),
    groups: [],
    itemGroups: new Map(),
    loading: false,

    fetchWatchlist: async () => {
        set({ loading: true })
        try {
            const [items, groups, itemGroupsArr] = await Promise.all([
                window.api.watchlist.getAll(),
                window.api.watchlist.getGroups(),
                window.api.watchlist.getItemGroups(),
            ])
            const itemGroups = new Map(itemGroupsArr)
            set({ items, groups, itemGroups, loading: false })
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

    addGroup: async (name) => {
        await window.api.watchlist.addGroup(name)
        const groups = await window.api.watchlist.getGroups()
        set({ groups })
    },

    removeGroup: async (name) => {
        await window.api.watchlist.removeGroup(name)
        const [groups, itemGroupsArr] = await Promise.all([
            window.api.watchlist.getGroups(),
            window.api.watchlist.getItemGroups(),
        ])
        set({ groups, itemGroups: new Map(itemGroupsArr) })
    },

    setItemGroup: async (id, group) => {
        await window.api.watchlist.setItemGroup(id, group)
        const itemGroupsArr = await window.api.watchlist.getItemGroups()
        set({ itemGroups: new Map(itemGroupsArr) })
    },
}))
