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
// Доезд после отпускания — как у экрана (fb_37f0c1a8): сглаженная скорость пальца,
// время и кривая из остатка пути (`settleMotion`).
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import {
  EDGE_PX, pushSample, releaseVelocity, settleMotion, swipeAxis, swipeBackBlocked, swipeCommits, textSelectionActive,
} from '../lib/screenNav.js'

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function useSheetSwipeBack(overlayRef, sheetRef, onDismiss, enabled) {
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    const overlay = overlayRef?.current
    if (!enabled || !overlay) return undefined

    let g = null // { x0, y0, edge, axis, dx, samples }
    let settling = false
    let settleTimer = null

    // motion — { ms, easing } доезда или null (за пальцем).
    const shift = (px, motion) => {
      const el = sheetRef.current
      if (!el) return
      el.style.transition = motion && !reducedMotion() ? `transform ${motion.ms}ms ${motion.easing}` : 'none'
      el.style.transform = px ? `translateX(${px}px)` : ''
    }
    const settle = (from, target, v, after) => {
      const motion = settleMotion(target - from, target > from ? v : -v)
      settling = true
      shift(target, motion)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(after, motion.ms)
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
      g = { x0: t.clientX, y0: t.clientY, edge, axis: null, dx: 0, samples: pushSample([], t.clientX, e.timeStamp) }
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
      pushSample(g.samples, t.clientX, e.timeStamp)
      g.dx = Math.max(0, dx)
      if (!reducedMotion()) shift(g.dx, null)
    }

    function onEnd(e) {
      if (!g) return
      const done = g
      g = null
      if (done.axis !== 'x') return
      const width = sheetRef.current?.clientWidth || window.innerWidth
      const v = releaseVelocity(done.samples, e?.timeStamp)
      if (swipeCommits(done.dx, v, width)) {
        if (reducedMotion()) { clearTimeout(settleTimer); settling = true; finish(); return }
        settle(done.dx, width, v, finish)
      } else {
        settle(done.dx, 0, v, clear)
      }
    }

    function onCancel() {
      if (!g) return
      const done = g
      g = null
      settle(done.dx, 0, 0, clear)
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
