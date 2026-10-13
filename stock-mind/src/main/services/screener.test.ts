import { describe, expect, it } from 'vitest'
import { applySnapshotFilters, boardOf, sortRows, type StockSnapshot } from './screener'

const snap = (code: string, name: string, patch: Partial<StockSnapshot> = {}): StockSnapshot => ({
    code,
    name,
    price: 10,
    changePercent: 1,
    amount: 5,
    turnover: 2,
    volumeRatio: 1.2,
    pe: 20,
    pb: 2,
    totalMv: 300,
    floatMv: 200,
    change60d: 5,
    changeYtd: 10,
    industry: '银行',
    ...patch,
})

const rows = [
    snap('600000', '浦发银行', { pe: 5, pb: 0.5, totalMv: 2500 }),
    snap('000001', '平安银行', { pe: 4, pb: 0.6, totalMv: 2200, amount: 20 }),
    snap('300750', '宁德时代', { pe: 25, pb: 5, totalMv: 13000, amount: 80 }),
    snap('688981', '中芯国际', { pe: 90, volumeRatio: null }),
    snap('600123', '*ST 某某', { pe: -3 }),
    snap('830799', '艾融软件', { amount: 0.5 }),
    snap('600999', '停牌股', { price: null, amount: 0 }),
]

describe('板块归属', () => {
    it.each([
        ['600519', 'sh_main'],
        ['900901', 'sh_main'],
        ['000001', 'sz_main'],
        ['002594', 'sz_main'],
        ['300750', 'cyb'],
        ['688981', 'kcb'],
        ['830799', 'bj'],
        ['920001', 'bj'],
    ])('%s → %s', (code, board) => {
        expect(boardOf(code)).toBe(board)
    })
})

describe('数值条件过滤', () => {
    const base = { scope: { type: 'all' as const } }

    it('区间上下限都生效', () => {
        const out = applySnapshotFilters(rows, { ...base, ranges: { pe: { min: 0, max: 15 }, totalMv: { min: 2300 } } })
        expect(out.map((r) => r.code)).toEqual(['600000'])
    })

    it('剔除 ST 和停牌', () => {
        const out = applySnapshotFilters(rows, { ...base, excludeST: true, excludeSuspended: true })
        expect(out.map((r) => r.code)).not.toContain('600123')
        expect(out.map((r) => r.code)).not.toContain('600999')
        expect(out).toHaveLength(5)
    })

    it('按板块过滤', () => {
        const out = applySnapshotFilters(rows, { ...base, boards: ['cyb', 'kcb'] })
        expect(out.map((r) => r.code)).toEqual(['300750', '688981'])
    })

    it('有条件但字段缺失的视为不满足（比如新浪源没有量比）', () => {
        const out = applySnapshotFilters(rows, { ...base, ranges: { volumeRatio: { min: 1 } } })
        expect(out.map((r) => r.code)).not.toContain('688981')
    })

    it('只填了空值的条件不生效', () => {
        const out = applySnapshotFilters(rows, { ...base, ranges: { pe: { min: null, max: null } } })
        expect(out).toHaveLength(rows.length)
    })
})

describe('排序', () => {
    it('降序时 null 排最后', () => {
        const out = sortRows(rows, 'volumeRatio', 'desc')
        expect(out[out.length - 1].code).toBe('688981')
    })

    it('按成交额升序', () => {
        const out = sortRows(rows, 'amount', 'asc')
        expect(out[0].code).toBe('600999')
        expect(out[out.length - 1].code).toBe('300750')
    })
})
