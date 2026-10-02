// Свайп назад от левого края на вложенных экранах (v6.8.1). Экран едет за пальцем;
// довел до трети ширины или бросил быстро — уезжает вправо и срабатывает тот же
// onBack, что у кнопки «‹»; отпустил раньше — возвращается на место.
//
// Двигаем `left` (экран — position:relative), а НЕ transform: transform сделал бы
// экран containing block для position:fixed потомков, и липкие бары прыгали бы
// (см. комментарий к .screen-anim в index.css).
//
// containerRef — скроллер (.content, на нем слушаем касания), screenRef — сам
// экран (.screen-anim). Решения по жесту — чистые функции lib/screenNav.js.
import { useEffect, useRef } from 'react'
import { EDGE_PX, swipeAxis, swipeCommits } from '../lib/screenNav.js'

const SETTLE_MS = 180

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function useEdgeSwipeBack(containerRef, screenRef, onBack, enabled) {
  // Свежий onBack без переподписки слушателей на каждый рендер.
  const backRef = useRef(onBack)
  useEffect(() => { backRef.current = onBack }, [onBack])

  useEffect(() => {
    const box = containerRef.current
    if (!enabled || !box) return undefined

    let g = null // { x0, y0, t0, axis, dx, lastX, lastT, v }
    let settleTimer = null

    const screen = () => screenRef.current
    const setLeft = (px, animate) => {
      const el = screen()
      if (!el) return
      el.style.transition = animate && !reducedMotion() ? `left ${SETTLE_MS}ms var(--ease-out)` : 'none'
      el.style.left = px ? `${px}px` : ''
    }
    const clear = () => {
      const el = screen()
      if (el) { el.style.transition = ''; el.style.left = ''; el.classList.remove('edge-dragging') }
    }

    function onStart(e) {
      if (g || e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX > EDGE_PX) return
      g = { x0: t.clientX, y0: t.clientY, axis: null, dx: 0, lastX: t.clientX, lastT: e.timeStamp, v: 0 }
    }

    function onMove(e) {
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      if (!g.axis) {
        g.axis = swipeAxis(dx, dy)
        if (g.axis === 'y') { g = null; return }
        if (!g.axis) return
        screen()?.classList.add('edge-dragging')
      }
      e.preventDefault() // наш жест: не прокручиваем и не отдаем странице
      const dt = Math.max(1, e.timeStamp - g.lastT)
      g.v = (t.clientX - g.lastX) / dt
      g.lastX = t.clientX
      g.lastT = e.timeStamp
      g.dx = Math.max(0, dx)
      setLeft(g.dx, false)
    }

    function onEnd() {
      if (!g) return
      const done = g
      g = null
      if (done.axis !== 'x') return
      const width = box.clientWidth || window.innerWidth
      if (swipeCommits(done.dx, done.v, width)) {
        setLeft(width, true)
        clearTimeout(settleTimer)
        // Экран уехал — дальше обычная «Назад»: смена tab размонтирует этот экран.
        settleTimer = setTimeout(() => backRef.current?.(), reducedMotion() ? 0 : SETTLE_MS)
      } else {
        setLeft(0, true)
        clearTimeout(settleTimer)
        settleTimer = setTimeout(clear, SETTLE_MS)
      }
    }

    function onCancel() {
      if (!g) return
      g = null
      setLeft(0, true)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(clear, SETTLE_MS)
    }

    box.addEventListener('touchstart', onStart, { passive: true })
    box.addEventListener('touchmove', onMove, { passive: false })
    box.addEventListener('touchend', onEnd)
    box.addEventListener('touchcancel', onCancel)
    return () => {
      box.removeEventListener('touchstart', onStart)
      box.removeEventListener('touchmove', onMove)
      box.removeEventListener('touchend', onEnd)
      box.removeEventListener('touchcancel', onCancel)
      clearTimeout(settleTimer)
    }
  }, [containerRef, screenRef, enabled])
}
