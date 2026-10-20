import { useCallback, useRef } from 'react'

// Ответ свайпом (20.10.2026): комментарий тянут влево — он едет за пальцем, справа
// проявляется стрелка ответа; отпустили дальше SWIPE_REPLY_AT — onReply(комментарий). Вертикальный жест
// и свайп вправо не трогаем: первый — прокрутка ветки, второй — закрытие листа (SheetDialog swipeBack).
// Сдвиг пишем прямо в style элемента (без setState на каждое движение пальца).
// bind(item) → обработчики touch* для элемента строки; enabled=false — пустой объект.
export const SWIPE_REPLY_AT = 56
const MAX_SHIFT = 80
const DEAD_ZONE = 8

export function useSwipeReply(onReply) {
  const gesture = useRef(null)
  const replyRef = useRef(onReply)
  replyRef.current = onReply

  return useCallback((item, enabled = true) => {
    const finish = (fire) => {
      const g = gesture.current
      gesture.current = null
      if (!g || g.axis !== 'x') return
      const el = g.el
      el.classList.remove('swiping', 'swipe-ready')
      el.style.transform = ''
      el.style.removeProperty('--swipe')
      if (fire && -g.dx >= SWIPE_REPLY_AT) replyRef.current?.(g.item)
    }
    if (!enabled) return {}
    return {
      onTouchStart(e) {
        const t = e.touches?.[0]
        if (!t || e.touches.length > 1) { gesture.current = null; return }
        gesture.current = { item, el: e.currentTarget, x: t.clientX, y: t.clientY, axis: null, dx: 0 }
      },
      onTouchMove(e) {
        const g = gesture.current
        const t = e.touches?.[0]
        if (!g || !t) return
        const dx = t.clientX - g.x
        const dy = t.clientY - g.y
        if (!g.axis) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < DEAD_ZONE) return
          g.axis = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y'
          if (g.axis === 'x') g.el.classList.add('swiping')
        }
        if (g.axis !== 'x') return
        g.dx = Math.max(-MAX_SHIFT, Math.min(0, dx))
        g.el.style.transform = `translateX(${g.dx}px)`
        g.el.style.setProperty('--swipe', String(Math.min(1, -g.dx / SWIPE_REPLY_AT)))
        g.el.classList.toggle('swipe-ready', -g.dx >= SWIPE_REPLY_AT)
      },
      onTouchEnd() { finish(true) },
      onTouchCancel() { finish(false) },
    }
  }, [])
}
