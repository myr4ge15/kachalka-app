// Свайп «назад» по листу (v8.1.1, обращение fb_9be302c1). На телефоне лист занимает
// весь экран — подсказка «Как выполнять» выглядит как вложенный экран, и палец
// тянется закрыть ее тем же свайпом вправо. Правила жеста — общие с
// hooks/useEdgeSwipeBack.js (lib/screenNav.js): с любой точки, от середины строже
// ось и жест уступает полю/ползунку/ручке/пролистанному ряду ([data-no-swipe-back]).
// Лист едет за пальцем; довел до трети ширины или бросил — уезжает вправо и
// закрывается тем же onDismiss, что «закрыть»; отпустил раньше — возвращается.
//
// Двигаем transform листа: в отличие от экрана (.screen-anim двигается `left`),
// внутри листа нет position:fixed потомков, а прокручивает его свой .sheet-scroll.
// Включается только там, где и свайп экранов (iOS «на экране Домой»), — решает
// SheetDialog по edgeSwipeAvailable().
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { EDGE_PX, swipeAxis, swipeBackBlocked, swipeCommits, textSelectionActive } from '../lib/screenNav.js'

const SETTLE_MS = 180

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function useSheetSwipeBack(overlayRef, sheetRef, onDismiss, enabled) {
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    const overlay = overlayRef?.current
    if (!enabled || !overlay) return undefined

    let g = null // { x0, y0, edge, axis, dx, lastX, lastT, v }
    let settling = false
    let settleTimer = null

    const shift = (px, animate) => {
      const el = sheetRef.current
      if (!el) return
      el.style.transition = animate && !reducedMotion() ? `transform ${SETTLE_MS}ms var(--ease-out)` : 'none'
      el.style.transform = px ? `translateX(${px}px)` : ''
    }
    const clear = () => {
      const el = sheetRef.current
      if (el) { el.style.transition = ''; el.style.transform = '' }
      settling = false
    }
    const finish = () => {
      // Лист уехал — закрываем синхронно, иначе между кадрами он вспыхнет на месте.
      flushSync(() => dismissRef.current?.())
      clear()
    }

    function onStart(e) {
      if (g || settling || e.touches.length !== 1) return
      const t = e.touches[0]
      const left = sheetRef.current?.getBoundingClientRect().left ?? 0
      const edge = t.clientX - left <= EDGE_PX
      if (!edge && swipeBackBlocked(e.target, overlay)) return
      if (textSelectionActive(window.getSelection?.())) return
      g = { x0: t.clientX, y0: t.clientY, edge, axis: null, dx: 0, lastX: t.clientX, lastT: e.timeStamp, v: 0 }
    }

    function onMove(e) {
      if (!g) return
      if (e.touches.length !== 1) { onCancel(); return }
      const t = e.touches[0]
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      if (!g.axis) {
        if (textSelectionActive(window.getSelection?.())) { g = null; return }
        g.axis = swipeAxis(dx, dy, g.edge)
        if (g.axis === 'y') { g = null; return }
        if (!g.axis) return
      }
      e.preventDefault()
      const dt = Math.max(1, e.timeStamp - g.lastT)
      g.v = (t.clientX - g.lastX) / dt
      g.lastX = t.clientX
      g.lastT = e.timeStamp
      g.dx = Math.max(0, dx)
      if (!reducedMotion()) shift(g.dx, false)
    }

    function onEnd() {
      if (!g) return
      const done = g
      g = null
      if (done.axis !== 'x') return
      const width = sheetRef.current?.clientWidth || window.innerWidth
      clearTimeout(settleTimer)
      settling = true
      if (swipeCommits(done.dx, done.v, width)) {
        if (reducedMotion()) { finish(); return }
        shift(width, true)
        settleTimer = setTimeout(finish, SETTLE_MS)
      } else {
        shift(0, true)
        settleTimer = setTimeout(clear, SETTLE_MS)
      }
    }

    function onCancel() {
      if (!g) return
      g = null
      settling = true
      shift(0, true)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(clear, SETTLE_MS)
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
      clearTimeout(settleTimer)
    }
  }, [overlayRef, sheetRef, enabled])
}
