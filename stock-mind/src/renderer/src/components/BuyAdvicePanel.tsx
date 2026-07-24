import type { KLineData } from '../types'
import { computePriceLevels } from '../utils/priceLevels'

interface Props {
    price: number
    changePercent: number
    dailyKlines?: KLineData[]
    weeklyKlines?: KLineData[]
    monthlyKlines?: KLineData[]
}

function fmt(p: number) {
    return p >= 10 ? p.toFixed(2) : p.toFixed(3)
}

export default function BuyAdvicePanel({
    price,
    changePercent,
    dailyKlines,
    weeklyKlines,
    monthlyKlines,
}: Props) {
    const isEtf = price < 20
    const isNearLimitDown = changePercent <= -8
    const isNearLimitUp = changePercent >= 8
    const isExtended = isEtf ? changePercent >= 2.5 : changePercent >= 4

    const plan = computePriceLevels(price, isEtf, dailyKlines, weeklyKlines, monthlyKlines)

    return (
        <div className="buy-advice-panel">
            <h3 className="buy-advice-title">
                📌 傻瓜价位参考
                <span className="buy-advice-basis-tag">
                    {plan.basis === 'kline'
                        ? '基于日/周/月K线静态技术位（不随现价跳动）'
                        : '基于现价比例（K线未加载）'}
                </span>
            </h3>

            {plan.positionHint && (
                <div className="buy-advice-position-hint">💡 {plan.positionHint}</div>
            )}

            {isNearLimitDown ? (
                <div className="buy-advice-skip">
                    ❌ 今日跌幅过大（{changePercent.toFixed(2)}%），暂不适合买入。等明天看是否企稳。
                </div>
            ) : isNearLimitUp ? (
                <div className="buy-advice-skip">
                    ❌ 今日涨幅过大（{changePercent.toFixed(2)}%），接近涨停，不追高。等回踩再看。
                </div>
            ) : (
                <>
                    {isExtended && (
                        <div className="buy-advice-warn">
                            ⚠️ 今日已涨 {changePercent.toFixed(2)}
                            %，位置偏高，建议只看保守挂单或等回踩。
                        </div>
                    )}
                    <div className="buy-advice-grid">
                        <div className="advice-item">
                            <span className="advice-label">激进挂单</span>
                            <span className="advice-value up">¥ {fmt(plan.aggressiveEntry)}</span>
                            <span className="advice-desc">{plan.notes.aggressive}</span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">保守挂单</span>
                            <span className="advice-value up">
                                ¥ {fmt(plan.conservativeEntry)}
                            </span>
                            <span className="advice-desc">{plan.notes.conservative}</span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">止损线</span>
                            <span className="advice-value down">¥ {fmt(plan.stopLoss)}</span>
                            <span className="advice-desc">{plan.notes.stop}</span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">第一止盈</span>
                            <span className="advice-value up">¥ {fmt(plan.takeProfit1)}</span>
                            <span className="advice-desc">{plan.notes.tp1}</span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">第二止盈</span>
                            <span className="advice-value up">¥ {fmt(plan.takeProfit2)}</span>
                            <span className="advice-desc">{plan.notes.tp2}</span>
                        </div>
                    </div>
                    <div className="buy-advice-rules">
                        <span>不买条件：</span>
                        涨幅超过 {isEtf ? '2.5' : '4'}% 不追 · 接近日内高点不追 · 板块整体转弱不买
                    </div>
                    <div className="buy-advice-note">
                        {plan.basis === 'kline'
                            ? '价位全部来自日/周/月K线的静态技术位（MA5/MA10/MA20/MA60、20日swing高低点、周线12周低点、月线24月主要低点），一天只在收盘后刷新，日内不会跟现价跳动。不构成投资建议。'
                            : '以上按现价比例临时估算，会随现价跳动。切换到"日K"周期加载K线后会按静态技术位重算。'}
                    </div>
                </>
            )}
        </div>
    )
}
