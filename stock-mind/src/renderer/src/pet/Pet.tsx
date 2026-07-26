import React, { useState, useEffect, useRef, useCallback } from 'react'

// AI生成的卡通风格头像
const petImage = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute%20anime%20girl%20avatar%2C%20long%20black%20hair%2C%20blue%20dress%2C%20soft%20lighting%2C%20kawaii%20style%2C%20pastel%20colors%2C%20simple%20background%2C%20chibi%20style%2C%20happy%20expression&image_size=square'

type PetState = 'idle' | 'happy' | 'thinking' | 'talking' | 'surprised' | 'bullish' | 'bearish'

interface BubbleMessage {
    id: number
    text: string
    type: 'info' | 'bullish' | 'bearish' | 'ai'
}

const Pet: React.FC = () => {
    const [state, setState] = useState<PetState>('idle')
    const [bubble, setBubble] = useState<BubbleMessage | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    
    const dragRef = useRef({ startX: 0, startY: 0, winX: 0, winY: 0 })
    const petRef = useRef<HTMLDivElement>(null)
    const bubbleIdRef = useRef(0)

    // 待机动画：随机切换状态
    useEffect(() => {
        const idleInterval = setInterval(() => {
            if (state === 'idle') {
                const rand = Math.random()
                if (rand < 0.1) setState('thinking')
                else if (rand < 0.2) setState('happy')
                else setState('idle')
            }
        }, 3000)

        return () => clearInterval(idleInterval)
    }, [state])

    // 自动恢复待机状态
    useEffect(() => {
        if (state !== 'idle') {
            const timer = setTimeout(() => setState('idle'), 2000)
            return () => clearTimeout(timer)
        }
    }, [state])

    // 显示气泡消息
    const showBubble = useCallback((text: string, type: BubbleMessage['type'] = 'info') => {
        const id = ++bubbleIdRef.current
        setBubble({ id, text, type })
        setTimeout(() => {
            setBubble((prev) => prev?.id !== id ? prev : null)
        }, 4000)
    }, [])

    // 点击宠物
    const handleClick = () => {
        if (isDragging) return
        
        const reactions = [
            { state: 'happy' as PetState, message: '你好呀！👋' },
            { state: 'thinking' as PetState, message: '正在分析市场趋势...' },
            { state: 'surprised' as PetState, message: '哇，吓我一跳！' },
            { state: 'happy' as PetState, message: '需要我帮忙看看股票吗？' },
        ]
        
        const randomReaction = reactions[Math.floor(Math.random() * reactions.length)]
        setState(randomReaction.state)
        showBubble(randomReaction.message)
    }

    // 拖拽开始
    const handleMouseDown = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        
        const winPos = await window.electron.ipcRenderer.invoke('pet:getPosition')
        
        dragRef.current = {
            startX: e.screenX,
            startY: e.screenY,
            winX: winPos.x,
            winY: winPos.y,
        }
        
        setIsDragging(true)
    }

    // 拖拽中
    useEffect(() => {
        if (!isDragging) return

        const handleMouseMove = (e: MouseEvent) => {
            const dx = e.screenX - dragRef.current.startX
            const dy = e.screenY - dragRef.current.startY
            
            window.electron.ipcRenderer.invoke(
                'pet:move',
                dragRef.current.winX + dx,
                dragRef.current.winY + dy
            )
        }

        const handleMouseUp = () => {
            setIsDragging(false)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging])

    // 监听股市数据变化
    useEffect(() => {
        const checkMarket = async () => {
            try {
                const watchlist = await window.api.watchlist.getAll()
                if (watchlist.length > 0) {
                    const codes = watchlist.map((item: { code: string }) => item.code)
                    const quotes = await window.api.market.getBatchQuotes(codes.slice(0, 5))
                    
                    const significantChanges = quotes.filter(
                        (q: { changePercent: number }) => Math.abs(q.changePercent) >= 2
                    )
                    
                    if (significantChanges.length > 0) {
                        const change = significantChanges[0]
                        if (change.changePercent > 0) {
                            setState('bullish')
                            showBubble(`${change.name} 涨了 ${change.changePercent.toFixed(2)}% 📈`, 'bullish')
                        } else {
                            setState('bearish')
                            showBubble(`${change.name} 跌了 ${Math.abs(change.changePercent).toFixed(2)}% 📉`, 'bearish')
                        }
                    }
                }
            } catch (error) {
                console.log('Market check error:', error)
            }
        }

        const interval = setInterval(checkMarket, 30000)
        checkMarket()

        return () => clearInterval(interval)
    }, [showBubble])

    // 监听主进程消息
    useEffect(() => {
        const handleNavigate = () => {
            setState('talking')
            showBubble('正在打开 AI 对话...', 'ai')
        }

        const handleStateUpdate = (_e: unknown, newState: { type: string; message?: string }) => {
            setState(newState.type as PetState)
            if (newState.message) {
                showBubble(newState.message, newState.type === 'bullish' ? 'bullish' : 'bearish')
            }
        }

        window.electron.ipcRenderer.on('navigate-to', handleNavigate)
        window.electron.ipcRenderer.on('pet:state', handleStateUpdate)

        return () => {
            window.electron.ipcRenderer.removeListener('navigate-to', handleNavigate)
            window.electron.ipcRenderer.removeListener('pet:state', handleStateUpdate)
        }
    }, [showBubble])

    return (
        <div
            ref={petRef}
            className="pet-container"
            onMouseDown={handleMouseDown}
            onClick={handleClick}
        >
            {/* 气泡消息 */}
            {bubble && (
                <div className={`bubble bubble-${bubble.type}`}>
                    <div className="bubble-arrow"></div>
                    <div className="bubble-content">{bubble.text}</div>
                </div>
            )}

            {/* 宠物主体 */}
            <div className={`pet ${state}`}>
                {/* 图片容器 */}
                <div className="pet-image-wrapper">
                    <img 
                        src={petImage} 
                        alt="Pet" 
                        className="pet-image"
                    />
                    
                    {/* 表情覆盖层 */}
                    {state === 'bullish' && (
                        <div className="emoji-overlay bullish">📈</div>
                    )}
                    {state === 'bearish' && (
                        <div className="emoji-overlay bearish">📉</div>
                    )}
                    {state === 'surprised' && (
                        <div className="emoji-overlay surprised">😲</div>
                    )}
                    {state === 'thinking' && (
                        <div className="thinking-bubbles">
                            <div className="bubble-small"></div>
                            <div className="bubble-medium"></div>
                            <div className="bubble-large"></div>
                        </div>
                    )}
                </div>

                {/* 底座/阴影 */}
                <div className="pet-shadow"></div>
            </div>

            {/* 样式 */}
            <style>{`
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }

                body {
                    overflow: hidden;
                    background: transparent;
                }

                .pet-container {
                    width: 120px;
                    height: 140px;
                    cursor: grab;
                    user-select: none;
                    position: relative;
                    -webkit-app-region: no-drag;
                }

                .pet-container:active {
                    cursor: grabbing;
                }

                /* 气泡消息 */
                .bubble {
                    position: absolute;
                    top: -60px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: white;
                    border-radius: 12px;
                    padding: 8px 12px;
                    font-size: 12px;
                    color: #333;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
                    max-width: 180px;
                    z-index: 100;
                    animation: bubbleIn 0.3s ease-out;
                }

                .bubble-bullish {
                    background: #ffebee;
                    border: 1px solid #ef5350;
                    color: #c62828;
                }

                .bubble-bearish {
                    background: #e3f2fd;
                    border: 1px solid #42a5f5;
                    color: #1565c0;
                }

                .bubble-ai {
                    background: #f3e5f5;
                    border: 1px solid #ab47bc;
                    color: #6a1b9a;
                }

                .bubble-arrow {
                    position: absolute;
                    bottom: -6px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 0;
                    height: 0;
                    border-left: 6px solid transparent;
                    border-right: 6px solid transparent;
                    border-top: 6px solid white;
                }

                .bubble-bullish .bubble-arrow {
                    border-top-color: #ef5350;
                }

                .bubble-bearish .bubble-arrow {
                    border-top-color: #42a5f5;
                }

                .bubble-ai .bubble-arrow {
                    border-top-color: #ab47bc;
                }

                .bubble-content {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                /* 宠物主体 */
                .pet {
                    width: 100px;
                    height: 110px;
                    margin: 0 auto;
                    position: relative;
                    animation: float 3s ease-in-out infinite;
                }

                .pet.happy {
                    animation: bounce 0.5s ease-in-out, float 3s ease-in-out infinite;
                }

                .pet.bullish {
                    animation: jump 0.6s ease-out, float 3s ease-in-out infinite;
                }

                .pet.bearish {
                    animation: shake 0.4s ease-in-out;
                }

                .pet.talking {
                    animation: talk 0.3s ease-in-out infinite;
                }

                .pet-image-wrapper {
                    width: 100%;
                    height: 100%;
                    position: relative;
                    border-radius: 50%;
                    overflow: hidden;
                    box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                    border: 3px solid rgba(255,255,255,0.8);
                }

                .pet-image {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    object-position: center;
                }

                /* 表情覆盖层 */
                .emoji-overlay {
                    position: absolute;
                    font-size: 24px;
                    animation: popIn 0.3s ease-out;
                }

                .emoji-overlay.bullish {
                    top: -5px;
                    right: -5px;
                }

                .emoji-overlay.bearish {
                    top: -5px;
                    left: -5px;
                }

                .emoji-overlay.surprised {
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 32px;
                }

                /* 思考气泡 */
                .thinking-bubbles {
                    position: absolute;
                    top: -30px;
                    right: -10px;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: 3px;
                    animation: thinkingFloat 1s ease-in-out infinite;
                }

                .bubble-small, .bubble-medium, .bubble-large {
                    background: rgba(255,255,255,0.9);
                    border-radius: 50%;
                    border: 2px solid rgba(0,0,0,0.15);
                }

                .bubble-small {
                    width: 8px;
                    height: 8px;
                }

                .bubble-medium {
                    width: 12px;
                    height: 12px;
                }

                .bubble-large {
                    width: 16px;
                    height: 16px;
                }

                /* 底座/阴影 */
                .pet-shadow {
                    width: 60px;
                    height: 10px;
                    background: rgba(0,0,0,0.2);
                    border-radius: 50%;
                    margin: 0 auto;
                    margin-top: -5px;
                    animation: shadowPulse 3s ease-in-out infinite;
                }

                /* 动画 */
                @keyframes float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                }

                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-15px); }
                }

                @keyframes jump {
                    0% { transform: translateY(0); }
                    50% { transform: translateY(-20px); }
                    100% { transform: translateY(0); }
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }

                @keyframes talk {
                    0%, 100% { transform: scaleY(1); }
                    50% { transform: scaleY(0.95); }
                }

                @keyframes popIn {
                    0% { opacity: 0; transform: scale(0); }
                    100% { opacity: 1; transform: scale(1); }
                }

                @keyframes thinkingFloat {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-5px); }
                }

                @keyframes shadowPulse {
                    0%, 100% { transform: scale(1); opacity: 0.2; }
                    50% { transform: scale(0.8); opacity: 0.25; }
                }

                @keyframes bubbleIn {
                    0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
                    100% { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `}</style>
        </div>
    )
}

export default Pet