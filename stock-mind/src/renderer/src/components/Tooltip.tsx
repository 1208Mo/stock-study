import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import React from 'react'

interface TooltipProps {
    children: React.ReactNode
    content: string
}

export function Tooltip({ children, content }: TooltipProps) {
    return (
        <TooltipPrimitive.Provider delayDuration={150}>
            <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>
                    {children}
                </TooltipPrimitive.Trigger>
                <TooltipPrimitive.Portal>
                    <TooltipPrimitive.Content
                        className="tooltip-content"
                        sideOffset={8}
                        side="top"
                    >
                        {content}
                        <TooltipPrimitive.Arrow className="tooltip-arrow" />
                    </TooltipPrimitive.Content>
                </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    )
}
