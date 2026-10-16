import { describe, it, expect } from 'vitest'
import { parseBrokenBoardPool, parseLimitDownPool } from './marketOverview'

// 字段取自东财 push2ex getTopicDTPool / getTopicZBPool 的真实返回（价格为「元 × 1000」）
const DT_POOL = [
    { c: '605069', n: '正和生态', p: 11060, zdp: -10.008, fund: 2755278, lbt: 144842, days: 1, oc: 3, hybk: '环境治理' },
    { c: '600000', n: '天马科技', p: 8000, zdp: -9.99, fund: 19514606, lbt: 93000, days: 3, oc: 0, hybk: '饲料' },
    { c: '603661', n: '恒林股份', p: 31640, zdp: -10.011, fund: 3714536, lbt: 150000, days: 1, oc: 2, hybk: '家居用品' },
]

const ZB_POOL = [
    { c: '600303', n: '曙光股份', p: 3120, zdp: -5.45, zf: 15.76, zbc: 1, fbt: 93004, hybk: '商用车' },
    { c: '605136', n: '丽人丽妆', p: 10400, zdp: -8.93, zf: 19.96, zbc: 2, fbt: 92500, hybk: '互联网电' },
]

describe('parseLimitDownPool', () => {
    it('按连续跌停天数从高到低分层', () => {
        const ladder = parseLimitDownPool(DT_POOL)
        expect(ladder.map((l) => l.days)).toEqual([3, 1])
        expect(ladder[0].stocks[0].name).toBe('天马科技')
    })

    it('同层按封单金额从大到小', () => {
        const first = parseLimitDownPool(DT_POOL).find((l) => l.days === 1)!
        expect(first.stocks.map((s) => s.code)).toEqual(['603661', '605069'])
    })

    it('换算价格与时间字段', () => {
        const s = parseLimitDownPool(DT_POOL).find((l) => l.days === 1)!.stocks[1]
        expect(s.price).toBeCloseTo(11.06)
        expect(s.lastSealTime).toBe('14:48')
        expect(s.openCount).toBe(3)
        expect(s.industry).toBe('环境治理')
    })

    it('空池返回空数组', () => {
        expect(parseLimitDownPool([])).toEqual([])
    })
})

describe('parseBrokenBoardPool', () => {
    it('回落最深的排在前面', () => {
        const list = parseBrokenBoardPool(ZB_POOL)
        expect(list.map((s) => s.name)).toEqual(['丽人丽妆', '曙光股份'])
    })

    it('换算价格、振幅、首次封板时间', () => {
        const s = parseBrokenBoardPool(ZB_POOL)[0]
        expect(s.price).toBeCloseTo(10.4)
        expect(s.amplitude).toBeCloseTo(19.96)
        expect(s.breakCount).toBe(2)
        expect(s.firstSealTime).toBe('09:25')
    })
})
