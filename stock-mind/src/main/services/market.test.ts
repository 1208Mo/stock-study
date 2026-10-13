import { describe, it, expect } from 'vitest'
import {
    parseEastmoneyQuote,
    parseSinaQuote,
    parseEastmoneyKlines,
    parseSinaKlines,
} from './market'

describe('parseEastmoneyQuote', () => {
    it('股票按 f59=2 位小数缩放价格，f170/f152 缩放涨跌幅', () => {
        // 贵州茅台样例：f43=132946 → 1329.46；f170=-39,f152=2 → -0.39%
        const q = parseEastmoneyQuote(
            {
                f43: 132946, f44: 133500, f45: 132000, f46: 133000, f47: 1234567,
                f48: 1.6e9, f58: '贵州茅台', f59: 2, f60: 133467, f152: 2, f170: -39,
            },
            '600519'
        )
        expect(q.price).toBeCloseTo(1329.46, 2)
        expect(q.open).toBeCloseTo(1330, 2)
        expect(q.high).toBeCloseTo(1335, 2)
        expect(q.low).toBeCloseTo(1320, 2)
        expect(q.changePercent).toBeCloseTo(-0.39, 2)
        expect(q.name).toBe('贵州茅台')
        expect(q.volume).toBe(1234567)
    })

    it('ETF/基金按 f59=3 位小数缩放', () => {
        const q = parseEastmoneyQuote(
            { f43: 1268, f44: 1270, f45: 1260, f46: 1265, f47: 100, f48: 1000, f58: '沪深300ETF', f59: 3, f60: 1260, f152: 2, f170: 63 },
            '510760'
        )
        expect(q.price).toBeCloseTo(1.268, 3)
        expect(q.changePercent).toBeCloseTo(0.63, 2)
    })

    it('无数据时抛错，便于上游降级', () => {
        expect(() => parseEastmoneyQuote(null, '600519')).toThrow()
        expect(() => parseEastmoneyQuote({ f58: 'x' }, '600519')).toThrow()
    })
})

describe('parseSinaQuote', () => {
    it('解析 hq_str 文本，价格为真实值无需缩放', () => {
        const text =
            'var hq_str_sh600519="贵州茅台,1330.00,1334.67,1329.46,1335.00,1320.00,1329.40,1329.46,1234567,1600000000,...";'
        const q = parseSinaQuote(text, '600519')
        expect(q.name).toBe('贵州茅台')
        expect(q.open).toBeCloseTo(1330, 2)
        expect(q.price).toBeCloseTo(1329.46, 2)
        expect(q.high).toBeCloseTo(1335, 2)
        expect(q.low).toBeCloseTo(1320, 2)
        expect(q.volume).toBe(1234567)
        // (1329.46-1334.67)/1334.67*100 ≈ -0.39%
        expect(q.changePercent).toBeCloseTo(-0.39, 2)
    })

    it('空行情（字段不足）时抛错，便于上游降级', () => {
        // 新浪对无效/退市代码返回空串
        expect(() => parseSinaQuote('var hq_str_sh600519="";', '600519')).toThrow()
        // 价格字段为空也抛错
        expect(() => parseSinaQuote('var hq_str_sh600519="贵州茅台,1330.00,1334.67,,,,,,0,0";', '600519')).toThrow()
    })
})

describe('parseEastmoneyKlines', () => {
    it('拆分字符串并把成交量从「手」换算成「股」(×100)', () => {
        const lines = ['2026-10-12,10.00,10.50,10.80,9.90,1000', '2026-10-13,10.50,10.20,10.60,10.10,2000']
        const bars = parseEastmoneyKlines(lines, 10)
        expect(bars).toHaveLength(2)
        expect(bars[0]).toEqual({ date: '2026-10-12', open: 10, close: 10.5, high: 10.8, low: 9.9, volume: 100000 })
        expect(bars[1].volume).toBe(200000)
    })

    it('按 limit 取最后 N 根', () => {
        const lines = ['a,1,1,1,1,1', 'b,2,2,2,2,2', 'c,3,3,3,3,3']
        expect(parseEastmoneyKlines(lines, 2).map((b) => b.date)).toEqual(['b', 'c'])
    })
})

describe('parseSinaKlines', () => {
    it('日线原样解析', () => {
        const list = [{ day: '2026-10-12', open: '10.0', high: '10.8', low: '9.9', close: '10.5', volume: '12345' }]
        expect(parseSinaKlines(list)[0]).toEqual({ date: '2026-10-12', open: 10, close: 10.5, high: 10.8, low: 9.9, volume: 12345 })
    })

    it('分钟线去掉秒，对齐东财分钟格式', () => {
        const list = [{ day: '2026-10-12 14:45:00', open: '10.0', high: '10.8', low: '9.9', close: '10.5', volume: '12345' }]
        expect(parseSinaKlines(list)[0].date).toBe('2026-10-12 14:45')
    })
})
