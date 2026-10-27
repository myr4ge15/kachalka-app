// Свайп вниз закрывает нижний лист (v8.8.1, просьба владельца: лист таймера отдыха).
// Как у системных листов iOS: лист едет за пальцем вниз; протянул на четверть высоты
// или бросил — уезжает и закрывается тем же onDismiss, что «готово»; иначе
// возвращается. Жест начинается, только когда содержимое листа прокручено к самому
// верху (иначе это обычная прокрутка вверх-вниз) и не на поле/ползунке/ряду со своим
// горизонтальным жестом ([data-no-swipe-back], правило lib/screenNav.js). Решение
// «ось» и «закрыть ли» — чистые lib/sheetTouch.js swipeDownAxis/swipeDownCommits.
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { swipeBackBlocked, textSelectionActive } from '../lib/screenNav.js'
import { scrollableAncestor, swipeDownAxis, swipeDownCommits } from '../lib/sheetTouch.js'

const SETTLE_MS = 200

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function useSheetSwipeDown(overlayRef, sheetRef, onDismiss, enabled) {
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    const overlay = overlayRef?.current
    if (!enabled || !overlay) return undefined
    let g = null // { x0, y0, axis, dy, lastY, lastT, v }
    let settling = false
    let timer = null

    const shift = (px, animate) => {
      const el = sheetRef.current
      if (!el) return
      el.style.transition = animate && !reducedMotion() ? `transform ${SETTLE_MS}ms var(--ease-out)` : 'none'
      el.style.transform = px ? `translateY(${px}px)` : ''
    }
    const clear = () => {
      const el = sheetRef.current
      if (el) { el.style.transition = ''; el.style.transform = '' }
      settling = false
    }
    const finish = () => { flushSync(() => dismissRef.current?.()); clear() }
    // У пикеров прокручивается свой список (.picker-list), а не .sheet-scroll (fb_d32a9a9c, 27.10.2026):
    // смотрим и общий скролл листа, и ближайший прокручиваемый блок под пальцем — пролистанный
    // вниз список жест «вниз» листает, а не закрывает лист.
    const atTop = (target) => {
      const sc = sheetRef.current?.querySelector('.sheet-scroll')
      if (sc && sc.scrollTop > 0) return false
      const box = scrollableAncestor(target, sheetRef.current)
      return !box || box.scrollTop <= 0
    }

    function onStart(e) {
      if (g || settling || e.touches.length !== 1) return
      if (!sheetRef.current?.contains(e.target)) return
      if (!atTop(e.target) || swipeBackBlocked(e.target, overlay)) return
      const t = e.touches[0]
      g = { x0: t.clientX, y0: t.clientY, axis: null, dy: 0, lastY: t.clientY, lastT: e.timeStamp, v: 0 }
    }
    function onMove(e) {
      if (!g) return
      if (e.touches.length !== 1) { onCancel(); return }
      const t = e.touches[0]
      const dy = t.clientY - g.y0
      if (!g.axis) {
        if (textSelectionActive(window.getSelection?.())) { g = null; return }
        g.axis = swipeDownAxis(t.clientX - g.x0, dy)
        if (g.axis === 'other') { g = null; return }
        if (!g.axis) return
      }
      if (e.cancelable) e.preventDefault()
      const dt = Math.max(1, e.timeStamp - g.lastT)
      g.v = (t.clientY - g.lastY) / dt
      g.lastY = t.clientY
      g.lastT = e.timeStamp
      g.dy = Math.max(0, dy)
      if (!reducedMotion()) shift(g.dy, false)
    }
    function onEnd() {
      if (!g) return
      const done = g
      g = null
      if (done.axis !== 'down') return
      const h = sheetRef.current?.offsetHeight || window.innerHeight
      clearTimeout(timer)
      settling = true
      if (swipeDownCommits(done.dy, done.v, h)) {
        if (reducedMotion()) { finish(); return }
        shift(h, true)
        timer = setTimeout(finish, SETTLE_MS)
      } else {
        shift(0, true)
        timer = setTimeout(clear, SETTLE_MS)
      }
    }
    function onCancel() {
      if (!g) return
      g = null
      settling = true
      shift(0, true)
      clearTimeout(timer)
      timer = setTimeout(clear, SETTLE_MS)
    }

    overlay.addEventListener('touchstart', onStart, { passive: true })
    overlay.addEventListener('touchmove', onMove, { passive: false })
    overlay.addEventListener('touchend', onEnd)
    overlay.addEventListener('touchcancel', onCancel)
    return () => {
      overlay.removeEventListener('touchstart', onStart)
      overlay.removeEventListener('touchmove', onMove)
      overlay.removeEventListener('touchend', onEnd)
      overlay.removeEventListener('touchcancel', onCancel)
      clearTimeout(timer)
    }
  }, [overlayRef, sheetRef, enabled])
}
