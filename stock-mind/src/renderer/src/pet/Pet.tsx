import React, { useState, useEffect, useRef, useCallback } from 'react'

import frame01Img from '../assets/pet-runtime/frame-01.png'
import frame02Img from '../assets/pet-runtime/frame-02.png'
import frame03Img from '../assets/pet-runtime/frame-03.png'
import frame04Img from '../assets/pet-runtime/frame-04.png'
import frame05Img from '../assets/pet-runtime/frame-05.png'
import frame06Img from '../assets/pet-runtime/frame-06.png'
import frame07Img from '../assets/pet-runtime/frame-07.png'

// 启动/长时间未互动后的打招呼语料
const GREET_LINES = ['Hi~我上班了', '今天也要一起加油呀', '嘿,回来啦?']
// 启动打招呼持续时长 & 长时间无互动阈值
const GREET_DURATION = 3000
const IDLE_GREET_THRESHOLD = 3 * 60 * 1000 // 3 分钟

// 点击反馈使用一组稳定的正面姿势帧，避免不同构图之间硬切。
type ClickAnim = 'pat'
type ClickFrame = { image: string; duration: number }
const PAT_FRAMES: ClickFrame[] = [
    { image: frame01Img, duration: 110 },
    { image: frame02Img, duration: 100 },
    { image: frame03Img, duration: 120 },
    { image: frame04Img, duration: 150 },
    { image: frame05Img, duration: 180 },
    { image: frame07Img, duration: 120 },
    { image: frame01Img, duration: 160 },
]

// 随机闲聊语料
const CHITCHAT: string[] = [
    '今天心情不错~',
    '要不要看看盘?',
    '记得喝口水呀',
    '休息一下吧',
    '别忘了复盘',
    'A 股加油!',
    '摸摸头~',
    '陪你一整天',
]

// 业务气泡文案继续保留，但视觉上统一为简约白色
type BubbleMessage = {
    id: number
    text: string
}

// 保留原有对外业务状态兼容
type BizState = 'idle' | 'bullish' | 'bearish' | 'thinking' | 'talking' | 'happy' | 'surprised'

const BASE_WIDTH = 160
const BASE_HEIGHT = 200
const MIN_SCALE = 0.6
const MAX_SCALE = 2.0

function isAshareTradingSession(date: Date = new Date()): boolean {
    const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    if (values.weekday === '周六' || values.weekday === '周日') return false
    const minuteOfDay = Number(values.hour) * 60 + Number(values.minute)
    return (
        (minuteOfDay >= 9 * 60 + 25 && minuteOfDay <= 11 * 60 + 35) ||
        (minuteOfDay >= 12 * 60 + 55 && minuteOfDay <= 15 * 60 + 5)
    )
}

const Pet: React.FC = () => {
    const [clickAnim, setClickAnim] = useState<ClickAnim | null>(null)
    const [clickFrameIdx, setClickFrameIdx] = useState(0)
    const [patRun, setPatRun] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const [bubble, setBubble] = useState<BubbleMessage | null>(null)
    const [scale, setScale] = useState(1)
    const [isGreeting, setIsGreeting] = useState(false)

    const isDraggingRef = useRef(false)
    const dragMovedRef = useRef(false)
    const dragRef = useRef({ startX: 0, startY: 0, winX: 0, winY: 0 })
    const petRef = useRef<HTMLDivElement>(null)
    const bubbleIdRef = useRef(0)
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const greetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastInteractionRef = useRef<number>(Date.now())
    const bizStateRef = useRef<BizState>('idle')
    const marketCheckInFlightRef = useRef(false)

    // 显示气泡
    const showBubble = useCallback((text: string) => {
        const id = ++bubbleIdRef.current
        setBubble({ id, text })
        setTimeout(() => {
            setBubble((prev) => (prev?.id !== id ? prev : null))
        }, 4000)
    }, [])

    // 触发一次"打招呼": 切 greet 帧 + 气泡
    const triggerGreet = useCallback(
        (line?: string) => {
            setIsGreeting(true)
            showBubble(line ?? GREET_LINES[Math.floor(Math.random() * GREET_LINES.length)])
            if (greetTimerRef.current) clearTimeout(greetTimerRef.current)
            greetTimerRef.current = setTimeout(() => setIsGreeting(false), GREET_DURATION)
        },
        [showBubble]
    )

    // 启动时打一次招呼
    useEffect(() => {
        triggerGreet('Hi~我上班了')
        lastInteractionRef.current = Date.now()
    }, [triggerGreet])

    // 空闲超过阈值 → 自动打招呼(每次触发后重置计时基线)
    useEffect(() => {
        const timer = setInterval(() => {
            if (Date.now() - lastInteractionRef.current >= IDLE_GREET_THRESHOLD) {
                triggerGreet()
                lastInteractionRef.current = Date.now()
            }
        }, 30000)
        return () => clearInterval(timer)
    }, [triggerGreet])

    // 随机闲聊气泡
    useEffect(() => {
        let cancelled = false
        const schedule = (): void => {
            const delay = 30000 + Math.random() * 30000 // 30-60s
            setTimeout(() => {
                if (cancelled) return
                const msg = CHITCHAT[Math.floor(Math.random() * CHITCHAT.length)]
                showBubble(msg)
                schedule()
            }, delay)
        }
        schedule()
        return () => {
            cancelled = true
        }
    }, [showBubble])

    // 触发单击动画
    const triggerClickAnim = useCallback(() => {
        lastInteractionRef.current = Date.now()
        setPatRun((run) => run + 1)
        setClickFrameIdx(0)
        setClickAnim('pat')
    }, [])

    // 每次点击播放一组姿势帧，最后回到待机状态；重复点击会从第一帧重播。
    useEffect(() => {
        if (!clickAnim) return

        const frame = PAT_FRAMES[clickFrameIdx]
        const timer = setTimeout(() => {
            if (clickFrameIdx >= PAT_FRAMES.length - 1) {
                setClickAnim(null)
                setClickFrameIdx(0)
                return
            }
            setClickFrameIdx((index) => index + 1)
        }, frame.duration)

        return () => clearTimeout(timer)
    }, [clickAnim, clickFrameIdx, patRun])

    // 鼠标按下：区分拖动 vs 点击
    const handleMouseDown = async (e: React.MouseEvent): Promise<void> => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()

        const winPos = await window.electron.ipcRenderer.invoke('pet:getPosition')
        dragRef.current = {
            startX: e.screenX,
            startY: e.screenY,
            winX: winPos.x,
            winY: winPos.y,
        }
        isDraggingRef.current = true
        dragMovedRef.current = false
    }

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent): void => {
            if (!isDraggingRef.current) return
            const dx = e.screenX - dragRef.current.startX
            const dy = e.screenY - dragRef.current.startY
            if (!dragMovedRef.current && dx * dx + dy * dy > 25) {
                dragMovedRef.current = true
                setIsDragging(true)
                setClickAnim(null)
                setClickFrameIdx(0)
            }
            if (dragMovedRef.current) {
                window.electron.ipcRenderer.invoke(
                    'pet:move',
                    dragRef.current.winX + dx,
                    dragRef.current.winY + dy
                )
            }
        }
        const handleMouseUp = (): void => {
            if (!isDraggingRef.current) return
            const wasClick = !dragMovedRef.current
            isDraggingRef.current = false
            setIsDragging(false)
            if (wasClick) triggerClickAnim()
        }
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [triggerClickAnim])

    // 滚轮缩放（节流 IPC）
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        lastInteractionRef.current = Date.now()
        setScale((prev) => {
            const step = e.deltaY < 0 ? 0.08 : -0.08
            const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + step))
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
            resizeTimerRef.current = setTimeout(() => {
                window.electron.ipcRenderer.invoke(
                    'pet:resize',
                    Math.round(BASE_WIDTH * next),
                    Math.round(BASE_HEIGHT * next)
                )
            }, 32)
            return next
        })
    }, [])

    // 兼容：股票行情联动 -> 触发气泡
    useEffect(() => {
        let cancelled = false
        const checkMarket = async (): Promise<void> => {
            if (!isAshareTradingSession() || marketCheckInFlightRef.current) return
            marketCheckInFlightRef.current = true
            try {
                const watchlist = await window.api.watchlist.getAll()
                if (!watchlist || watchlist.length === 0) return
                const codes = watchlist.map((item: { code: string }) => item.code)
                const quotes = await window.api.market.getBatchQuotes(codes.slice(0, 5))
                const significantChanges = quotes.filter(
                    (q: { changePercent: number }) => Math.abs(q.changePercent) >= 2
                )
                if (cancelled || significantChanges.length === 0) return
                const change = significantChanges[0]
                const sign = change.changePercent > 0 ? '涨了' : '跌了'
                showBubble(
                    `${change.name} ${sign} ${Math.abs(change.changePercent).toFixed(2)}%`
                )
            } catch {
                // 忽略：不需要的话不影响桌宠
            } finally {
                marketCheckInFlightRef.current = false
            }
        }
        const interval = setInterval(checkMarket, 30000)
        checkMarket()
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [showBubble])

    // 兼容：主进程推送的状态
    useEffect(() => {
        const handleNavigate = (): void => {
            showBubble('正在打开 AI 对话...')
        }
        const handleStateUpdate = (
            _e: unknown,
            newState: { type: string; message?: string }
        ): void => {
            bizStateRef.current = newState.type as BizState
            if (newState.message) showBubble(newState.message)
        }
        window.electron.ipcRenderer.on('navigate-to', handleNavigate)
        window.electron.ipcRenderer.on('pet:state', handleStateUpdate)
        return () => {
            window.electron.ipcRenderer.removeListener('navigate-to', handleNavigate)
            window.electron.ipcRenderer.removeListener('pet:state', handleStateUpdate)
        }
    }, [showBubble])

    const currentImage = clickAnim
        ? PAT_FRAMES[clickFrameIdx].image
        : isGreeting
          ? frame05Img
          : bubble
            ? frame03Img
            : isDragging
              ? frame06Img
              : frame01Img

    return (
        <div
            ref={petRef}
            className="pet-container"
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
        >
            {bubble && (
                <div className="bubble">
                    <div className="bubble-content">{bubble.text}</div>
                    <div className="bubble-arrow" />
                </div>
            )}

            <div className={`pet ${clickAnim ?? ''}`}>
                <img src={currentImage} alt="Pet" className="pet-image" draggable={false} />
            </div>

            <style>{`
                * { margin: 0; padding: 0; box-sizing: border-box; }
                html, body, #pet-root {
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background: transparent;
                }

                .pet-container {
                    width: 100%;
                    height: 100%;
                    position: relative;
                    cursor: grab;
                    user-select: none;
                    -webkit-app-region: no-drag;
                    -webkit-user-drag: none;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                }
                .pet-container:active { cursor: grabbing; }

                /* 简约白色气泡 */
                .bubble {
                    position: absolute;
                    top: 4px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #ffffff;
                    color: #333;
                    font-size: 12px;
                    line-height: 1.4;
                    padding: 8px 12px;
                    border-radius: 14px;
                    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.10);
                    max-width: 180px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    z-index: 10;
                    animation: bubbleIn 0.25s ease-out;
                }
                .bubble-arrow {
                    position: absolute;
                    bottom: -5px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 10px;
                    height: 10px;
                    background: #ffffff;
                    box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.06);
                    clip-path: polygon(0 0, 100% 0, 50% 100%);
                }
                .bubble-content {
                    position: relative;
                    z-index: 1;
                }

                /* 人物本体 */
                .pet {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                    transform-origin: 50% 100%;
                }
                .pet-image {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    pointer-events: none;
                    -webkit-user-drag: none;
                }

                .pet.pat {
                    animation: petPat 940ms ease-out;
                }
                @keyframes petPat {
                    0%, 100% { transform: translateY(0) scale(1); }
                    18% { transform: translateY(1px) scale(0.99, 0.985); }
                    42% { transform: translateY(-2px) scale(1.01, 1); }
                    68% { transform: translateY(0) rotate(-1deg); }
                    84% { transform: translateY(0) rotate(1deg); }
                }
                @keyframes bubbleIn {
                    0%   { opacity: 0; transform: translateX(-50%) translateY(6px); }
                    100% { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `}</style>
        </div>
    )
}

export default Pet
