import { useEffect, useRef } from 'react'

// Удержание элемента (аудит 16.10, реакции в Ленте): onLong через `ms` удержания пальца или
// мыши. Сдвиг пальца больше `slop` — это прокрутка, не удержание. После удержания ближайший
// click гасится (`wasLong()` вернет true один раз), чтобы удержание реакции не ставило/не
// снимало ее. Контекстное меню (долгий тап на iOS/Android) подавляется.
// onLong(arg, el) — el: удерживаемый элемент. onEnd(arg) — палец отпущен после удержания
// (облачко «кто поставил» живет, пока держат, fb_09a0e8d2).
export function useLongPress(onLong, { ms = 450, slop = 10, onEnd } = {}) {
  const timer = useRef(null)
  const start = useRef(null)
  const fired = useRef(false)
  const cb = useRef(onLong)
  const end = useRef(onEnd)
  useEffect(() => { cb.current = onLong; end.current = onEnd })
  useEffect(() => () => clearTimeout(timer.current), [])

  const cancel = () => { clearTimeout(timer.current); timer.current = null }
  const release = (arg) => {
    cancel()
    if (fired.current && start.current) end.current?.(arg)
    start.current = null
  }

  const bind = (arg) => ({
    onPointerDown: (e) => {
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      const el = e.currentTarget
      cancel()
      timer.current = setTimeout(() => { fired.current = true; cb.current?.(arg, el) }, ms)
    },
    onPointerMove: (e) => {
      const s = start.current
      if (s && !fired.current && Math.hypot(e.clientX - s.x, e.clientY - s.y) > slop) cancel()
    },
    onPointerUp: () => release(arg),
    onPointerCancel: () => release(arg),
    onPointerLeave: () => release(arg),
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
