import { useRef, useCallback } from 'react'

interface NumberInputProps {
  value: string
  onChange: (value: string) => void
  step?: number
  min?: number
  max?: number
  placeholder?: string
  disabled?: boolean
  className?: string
}

export default function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  placeholder,
  disabled,
  className = '',
}: NumberInputProps) {
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getNumericValue = () => {
    const n = parseFloat(value)
    return isNaN(n) ? 0 : n
  }

  const clamp = (n: number) => {
    if (min !== undefined && n < min) n = min
    if (max !== undefined && n > max) n = max
    return n
  }

  const stepValue = (direction: 1 | -1) => {
    const current = getNumericValue()
    const next = clamp(current + direction * step)
    const decimals = step.toString().includes('.') ? (step.toString().split('.')[1]?.length ?? 0) : 0
    const fixed = Number(next.toFixed(decimals))
    onChange(String(fixed))
  }

  const startRepeat = useCallback(
    (direction: 1 | -1) => {
      stepValue(direction)
      delayTimer.current = setTimeout(() => {
        repeatTimer.current = setInterval(() => {
          stepValue(direction)
        }, 60)
      }, 350)
    },
    [value, step, min, max]
  )

  const stopRepeat = useCallback(() => {
    if (delayTimer.current) {
      clearTimeout(delayTimer.current)
      delayTimer.current = null
    }
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current)
      repeatTimer.current = null
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      stepValue(1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      stepValue(-1)
    }
  }

  return (
    <div className={`number-input ${className}`}>
      <button
        type="button"
        className="number-input-btn number-input-btn-decrease"
        disabled={disabled}
        onMouseDown={() => startRepeat(-1)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => startRepeat(-1)}
        onTouchEnd={stopRepeat}
        tabIndex={-1}
        aria-label="减少"
      >
        <svg viewBox="0 0 12 12" width="12" height="12">
          <line x1="3" y1="6" x2="9" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <input
        className="number-input-field"
        type="text"
        inputMode="decimal"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      <button
        type="button"
        className="number-input-btn number-input-btn-increase"
        disabled={disabled}
        onMouseDown={() => startRepeat(1)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        onTouchStart={() => startRepeat(1)}
        onTouchEnd={stopRepeat}
        tabIndex={-1}
        aria-label="增加"
      >
        <svg viewBox="0 0 12 12" width="12" height="12">
          <line x1="3" y1="6" x2="9" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="3" x2="6" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
