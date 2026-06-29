import { useRef, useCallback, useEffect } from 'react'
import { HOLD_START, nextHoldDelay } from '../lib/hold.js'

// Кнопка степпера с длинным нажатием (long-press auto-repeat). Один тап =
// один вызов onTrigger; если кнопку удерживают — onTrigger повторяется сам,
// с ускорением, пока палец/кнопка не отпущены. Работает на тач и мышь
// (Pointer Events). Без onClick, чтобы тап не срабатывал дважды.
export default function HoldButton({ onTrigger, children, className, disabled, ...rest }) {
  const timer = useRef(null)
  const delay = useRef(HOLD_START)
  const cb = useRef(onTrigger)
  cb.current = onTrigger

  const stop = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  // На размонтировании гасим таймер (защита от утечки при удалении подхода/строки).
  useEffect(() => stop, [stop])

  const tick = useCallback(() => {
    cb.current?.()
    delay.current = nextHoldDelay(delay.current)
    timer.current = setTimeout(tick, delay.current)
  }, [])

  const start = useCallback((e) => {
    if (disabled) return
    if (e.button != null && e.button !== 0) return // только основная кнопка/тач
    e.preventDefault()
    cb.current?.()              // мгновенный отклик на первый тап
    delay.current = HOLD_START  // пауза перед стартом авто-повтора
    timer.current = setTimeout(tick, delay.current)
  }, [disabled, tick])

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      {...rest}
    >
      {children}
    </button>
  )
}
