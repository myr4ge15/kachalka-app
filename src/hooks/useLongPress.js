import { useEffect, useRef } from 'react'

// Удержание элемента (аудит 16.10, реакции в Ленте): onLong через `ms` удержания пальца или
// мыши. Сдвиг пальца больше `slop` — это прокрутка, не удержание. После удержания ближайший
// click гасится (`wasLong()` вернет true один раз), чтобы удержание реакции не ставило/не
// снимало ее. Контекстное меню (долгий тап на iOS/Android) подавляется.
export function useLongPress(onLong, { ms = 450, slop = 10 } = {}) {
  const timer = useRef(null)
  const start = useRef(null)
  const fired = useRef(false)
  const cb = useRef(onLong)
  useEffect(() => { cb.current = onLong })
  useEffect(() => () => clearTimeout(timer.current), [])

  const cancel = () => { clearTimeout(timer.current); timer.current = null }

  const bind = (arg) => ({
    onPointerDown: (e) => {
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      cancel()
      timer.current = setTimeout(() => { fired.current = true; cb.current?.(arg) }, ms)
    },
    onPointerMove: (e) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > slop) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => e.preventDefault(),
  })

  // true — это был click после удержания (его надо пропустить); сбрасывается.
  const wasLong = () => {
    const v = fired.current
    fired.current = false
    return v
  }

  return { bind, wasLong }
}
