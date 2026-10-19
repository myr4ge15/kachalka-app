import { useRef, useCallback, useEffect } from 'react'
import { HOLD_START, HOLD_SLOP, nextHoldDelay } from '../../lib/hold.js'

// Кнопка степпера с длинным нажатием (long-press auto-repeat). Один тап =
// один вызов onTrigger; если кнопку удерживают — onTrigger повторяется сам,
// с ускорением, пока палец/кнопка не отпущены. Работает на тач и мышь
// (Pointer Events).
// Тап считается на ОТПУСКАНИИ, а не на касании (fb_52059bc8): палец, начавший
// прокрутку на «+» последнего подхода, раньше тут же прибавлял повтор — «сам
// добавляет повтор при завершении упражнения». Сдвиг больше HOLD_SLOP или
// pointercancel (прокрутку забрал браузер) — это не тап: ничего не меняем.
// Авто-повтор — после HOLD_START удержания на месте; первый его шаг и есть «тап».
// Клик с клавиатуры (detail === 0) — один шаг; клик после касания пропускаем.
export default function HoldButton({ onTrigger, children, className, disabled, ...rest }) {
  const timer = useRef(null)
  const delay = useRef(HOLD_START)
  const pointer = useRef(null)
  const target = useRef(null)
  const origin = useRef(null) // { x, y } точки касания; null — касания нет
  const fired = useRef(false) // авто-повтор уже сработал — отпускание шаг не добавляет
  const cb = useRef(onTrigger)
  cb.current = onTrigger

  const stop = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pointer.current != null && target.current?.hasPointerCapture?.(pointer.current)) {
      try { target.current.releasePointerCapture(pointer.current) } catch { /* уже отпущен */ }
    }
    pointer.current = null
    target.current = null
    origin.current = null
  }, [])

  // На размонтировании гасим таймер (защита от утечки при удалении подхода/строки).
  useEffect(() => stop, [stop])

  const tick = useCallback(() => {
    fired.current = true
    cb.current?.()
    delay.current = nextHoldDelay(delay.current)
    timer.current = setTimeout(tick, delay.current)
  }, [])

  const start = useCallback((e) => {
    if (disabled) return
    if (e.button != null && e.button !== 0) return // только основная кнопка/тач
    e.preventDefault()
    // Захват гарантирует pointerup/pointercancel даже если палец ушел за кнопку.
    // Без него потерянный pointerup оставлял auto-repeat навсегда активным:
    // частые React-обновления выглядели как полностью «зависший» скролл.
    pointer.current = e.pointerId
    target.current = e.currentTarget
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* fallback: pointerleave */ }
    origin.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
    fired.current = false
    delay.current = HOLD_START  // пауза перед стартом авто-повтора
    timer.current = setTimeout(tick, delay.current)
  }, [disabled, tick])

  const move = useCallback((e) => {
    const o = origin.current
    if (!o || fired.current) return
    if (Math.abs((e.clientX ?? 0) - o.x) > HOLD_SLOP || Math.abs((e.clientY ?? 0) - o.y) > HOLD_SLOP) stop()
  }, [stop])

  const release = useCallback(() => {
    const tap = origin.current && !fired.current
    stop()
    if (tap) cb.current?.()
  }, [stop])

  const click = useCallback((e) => {
    if (disabled || e.detail !== 0) return
    cb.current?.()
  }, [disabled])

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={release}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onClick={click}
      {...rest}
    >
      {children}
    </button>
  )
}
