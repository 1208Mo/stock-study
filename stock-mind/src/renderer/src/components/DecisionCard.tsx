import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatDecisionResult } from '../stores/chatSessionsStore'
import type { StructuredDecisionPick } from '../types'

const REGIME_LABEL: Record<string, string> = {
    offensive: '大盘偏强',
    defensive: '大盘震荡',
    cash: '大盘偏弱',
}

function money(v: number | null): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    return v >= 10 ? v.toFixed(2) : v.toFixed(3)
}

function AdoptAlertsButton({ pick }: { pick: StructuredDecisionPick }) {
    const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
    if (pick.stopLoss === null && pick.takeProfit === null) return null

    const adopt = async () => {
        setState('saving')
        try {
            if (pick.stopLoss !== null) {
                await window.api.alerts.add({
                    code: pick.code,
                    name: pick.name,
                    kind: 'price_below',
                    target: pick.stopLoss,
                    note: 'AI 止损位',
                    source: 'ai',
                })
            }
            if (pick.takeProfit !== null) {
                await window.api.alerts.add({
                    code: pick.code,
                    name: pick.name,
                    kind: 'price_above',
                    target: pick.takeProfit,
                    note: 'AI 止盈位',
                    source: 'ai',
                })
            }
            setState('done')
        } catch {
            setState('error')
        }
    }

    return (
        <button className="chat-pick-adopt" onClick={adopt} disabled={state === 'saving' || state === 'done'}>
            {state === 'done' ? '✓ 已设提醒' : state === 'error' ? '设置失败，重试' : '🔔 止损/止盈提醒'}
        </button>
    )
}

interface Props {
    data: ChatDecisionResult
    onOpenFull: () => void
}

// 对话流内的「今日计划」卡片：紧凑呈现大盘状态 + 结构化选股，完整多空辩论/候选价位在工作台
export default function DecisionCard({ data, onOpenFull }: Props) {
    const { marketRegime, structuredDecision, decision, marketContext } = data
    const picks = structuredDecision?.picks ?? []
    const diag = data.diagnostics
    const hasDebate = !!(diag && (diag.bullResearch || diag.bearResearch || (diag.riskVerdicts && diag.riskVerdicts.length > 0)))
    const turns = diag?.debateHistory ?? []
    const rounds = diag?.debateRounds ?? 1

    return (
        <div className="chat-decision-card">
            <div className="chat-decision-head">
                <span className="chat-decision-title">📅 今日计划</span>
                {marketRegime && (
                    <span className={`regime-badge ${marketRegime.regime}`}>
                        {REGIME_LABEL[marketRegime.regime] ?? marketRegime.regime} · 得分{' '}
                        {marketRegime.score}
                    </span>
                )}
            </div>

            {structuredDecision?.summary && (
                <p className="chat-decision-summary">{structuredDecision.summary}</p>
            )}

            {picks.length > 0 ? (
                <div className="chat-decision-picks">
                    {picks.map((p) => (
                        <div
                            key={`${p.code}-${p.priority}`}
                            className={`chat-pick ${p.action === 'avoid' ? 'avoid' : ''}`}
                        >
                            <div className="chat-pick-head">
                                <span className="chat-pick-rank">
                                    {p.action === 'avoid' ? '回避' : `#${p.priority}`}
                                </span>
                                <span className="chat-pick-name">
                                    {p.code} {p.name}
                                </span>
                                {p.action !== 'avoid' && p.positionAmount > 0 && (
                                    <span className="chat-pick-pos">仓位 ≈ {p.positionAmount} 元</span>
                                )}
                            </div>
                            <div className="chat-pick-reason">{p.reason}</div>
                            {p.action !== 'avoid' && (
                                <div className="chat-pick-levels">
                                    <span>激进 {money(p.aggressiveEntry)}</span>
                                    <span>保守 {money(p.conservativeEntry)}</span>
                                    <span className="down">止损 {money(p.stopLoss)}</span>
                                    <span className="up">止盈 {money(p.takeProfit)}</span>
                                    <AdoptAlertsButton pick={p} />
                                </div>
                            )}
                            {p.noBuyCondition && (
                                <div className="chat-pick-nobuy">不买：{p.noBuyCondition}</div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                decision && (
                    <div className="markdown-body chat-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{decision}</ReactMarkdown>
                    </div>
                )
            )}

            {marketContext && (
                <details className="chat-decision-context">
                    <summary>市场背景 & 主线方向</summary>
                    <div className="markdown-body chat-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{marketContext}</ReactMarkdown>
                    </div>
                </details>
            )}

            {picks.length === 0 && diag && (
                <details className="chat-decision-context" open>
                    <summary>运行诊断（为什么没有结果）</summary>
                    <div className="chat-decision-diag">
                        <div className="chat-diag-line">
                            发现候选 {diag.discoveredCandidates?.length ?? 0} · 行情成功{' '}
                            {diag.quoteCount ?? 0} · 过滤后 {diag.filteredQuoteCount ?? 0}
                        </div>
                        {diag.workflowNotes && diag.workflowNotes.length > 0 && (
                            <ul className="chat-risk-verdicts">
                                {diag.workflowNotes.map((n, i) => (
                                    <li key={i}>{n}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </details>
            )}

            {hasDebate && diag && (
                <details className="chat-decision-context">
                    <summary>
                        多空辩论 & 风控裁决
                        {rounds > 1 ? `（${rounds} 轮交替反驳）` : ''}
                    </summary>
                    <div className="chat-debate-mini">
                        {/* 有逐轮记录时按发言顺序展示，能看出谁在反驳谁；否则退回旧的两段式 */}
                        {turns.length > 0
                            ? turns.map((t, i) => (
                                  <div className="chat-debate-block" key={i}>
                                      <span className={`chat-debate-tag ${t.side === 'bull' ? 'up' : 'down'}`}>
                                          {t.side === 'bull' ? '🐂 多头' : '🐻 空头'}
                                          {rounds > 1 ? ` · 第 ${t.round} 轮` : ''}
                                      </span>
                                      <div className="markdown-body chat-markdown">
                                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                                      </div>
                                  </div>
                              ))
                            : null}
                        {turns.length === 0 && diag.bullResearch && (
                            <div className="chat-debate-block">
                                <span className="chat-debate-tag up">🐂 多头</span>
                                <div className="markdown-body chat-markdown">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {diag.bullResearch}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        )}
                        {turns.length === 0 && diag.bearResearch && (
                            <div className="chat-debate-block">
                                <span className="chat-debate-tag down">🐻 空头</span>
                                <div className="markdown-body chat-markdown">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {diag.bearResearch}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        )}
                        {diag.riskVerdicts && diag.riskVerdicts.length > 0 && (
                            <div className="chat-debate-block">
                                <span className="chat-debate-tag">🛡️ 风控官</span>
                                <ul className="chat-risk-verdicts">
                                    {diag.riskVerdicts.map((v, i) => (
                                        <li key={i}>{v}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </details>
            )}

            <button className="btn-small chat-decision-more" onClick={onOpenFull}>
                查看我的决策 & 战绩 →
            </button>
        </div>
    )
}
