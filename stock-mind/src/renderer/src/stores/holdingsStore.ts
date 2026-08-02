import { create } from 'zustand'
import type { Holding, QuoteData } from '../types'

interface HoldingWithQuote extends Holding {
    quote?: QuoteData
    profit?: number
    profitPercent?: number
}

interface HoldingsState {
    holdings: HoldingWithQuote[]
    loading: boolean
    error: string | null
    fetchHoldings: () => Promise<void>
    refreshQuotes: () => Promise<void>
    addHolding: (code: string, name: string, costPrice: number, quantity: number, sector?: string, subSector?: string) => Promise<void>
    updateHolding: (id: number, costPrice: number, quantity: number) => Promise<void>
    updateSector: (id: number, sector: string, subSector: string) => Promise<void>
    deleteHolding: (id: number) => Promise<void>
    addTrade: (holdingId: number, tradeType: 'buy' | 'sell', costPrice: number, quantity: number, note?: string) => Promise<void>
}

export const useHoldingsStore = create<HoldingsState>((set, get) => ({
    holdings: [],
    loading: false,
    error: null,

    fetchHoldings: async () => {
        set({ loading: true, error: null })
        try {
            const holdings = await window.api.holdings.getAll()
            set({ holdings, loading: false })
            get().refreshQuotes()
        } catch (e) {
            set({ error: String(e), loading: false })
        }
    },

    refreshQuotes: async () => {
        const { holdings } = get()
        if (holdings.length === 0) return
        try {
            const codes = holdings.map((h) => h.code)
            const quotes = await window.api.market.getBatchQuotes(codes)
            const quoteMap = new Map(quotes.map((q) => [q.code, q]))

            const updated = holdings.map((h) => {
                const quote = quoteMap.get(h.code)
                if (!quote) return h
                const costPrice = h.avg_cost_price ?? h.cost_price
                const profit = (quote.price - costPrice) * h.quantity
                const profitPercent = ((quote.price - costPrice) / costPrice) * 100
                return { ...h, quote, profit, profitPercent }
            })
            set({ holdings: updated })
        } catch (e) {
            console.error('Failed to refresh quotes:', e)
        }
    },

    addHolding: async (code, name, costPrice, quantity, sector, subSector) => {
        await window.api.holdings.add(code, name, costPrice, quantity, sector, subSector)
        await get().fetchHoldings()
    },

    updateHolding: async (id, costPrice, quantity) => {
        await window.api.holdings.update(id, costPrice, quantity)
        await get().fetchHoldings()
    },

    updateSector: async (id, sector, subSector) => {
        await window.api.holdings.updateSector(id, sector, subSector)
        await get().fetchHoldings()
    },

    deleteHolding: async (id) => {
        await window.api.holdings.delete(id)
        await get().fetchHoldings()
    },

    addTrade: async (holdingId, tradeType, costPrice, quantity, note) => {
        await window.api.holdings.addTrade(holdingId, tradeType, costPrice, quantity, note)
        await get().fetchHoldings()
    },
}))
