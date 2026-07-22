interface Props {
    price: number
    changePercent: number
}

function fmt(p: number) {
    return p >= 10 ? p.toFixed(2) : p.toFixed(3)
}

export default function BuyAdvicePanel({ price, changePercent }: Props) {
    const isEtf = price < 20
    const isNearLimitDown = changePercent <= -8
    const isNearLimitUp = changePercent >= 8
    const isExtended = isEtf ? changePercent >= 2.5 : changePercent >= 4

    const aggressiveEntry = price * (isEtf ? 0.995 : 0.99)
    const conservativeEntry = price * (isEtf ? 0.985 : 0.975)
    const stopLoss = price * (isEtf ? 0.97 : 0.963)
    const takeProfit1 = price * (isEtf ? 1.025 : 1.04)
    const takeProfit2 = price * (isEtf ? 1.05 : 1.08)

    return (
        <div className="buy-advice-panel">
            <h3 className="buy-advice-title">📌 傻瓜价位参考</h3>

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
                            <span className="advice-value up">¥ {fmt(aggressiveEntry)}</span>
                            <span className="advice-desc">
                                现价 × {isEtf ? '0.995' : '0.990'}，小仓试错
                            </span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">保守挂单</span>
                            <span className="advice-value up">¥ {fmt(conservativeEntry)}</span>
                            <span className="advice-desc">
                                现价 × {isEtf ? '0.985' : '0.975'}，等明显回踩
                            </span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">止损线</span>
                            <span className="advice-value down">¥ {fmt(stopLoss)}</span>
                            <span className="advice-desc">跌破此价不补仓，直接出</span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">第一止盈</span>
                            <span className="advice-value up">¥ {fmt(takeProfit1)}</span>
                            <span className="advice-desc">
                                现价 × {isEtf ? '1.025' : '1.040'}，可减半仓
                            </span>
                        </div>
                        <div className="advice-item">
                            <span className="advice-label">第二止盈</span>
                            <span className="advice-value up">¥ {fmt(takeProfit2)}</span>
                            <span className="advice-desc">
                                现价 × {isEtf ? '1.050' : '1.080'}，强势才持到
                            </span>
                        </div>
                    </div>
                    <div className="buy-advice-rules">
                        <span>不买条件：</span>
                        涨幅超过 {isEtf ? '2.5' : '4'}% 不追 · 接近日内高点不追 · 板块整体转弱不买
                    </div>
                    <div className="buy-advice-note">
                        以上基于当前报价自动计算，不构成投资建议。实际操作以交易软件实时价为准。
                    </div>
                </>
            )}
        </div>
    )
}
