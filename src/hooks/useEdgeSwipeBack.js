// Свайп назад на вложенных экранах (v6.8.1 — от левого края; с v7.1.7 — с любой
// точки экрана, как в iOS 26). Экран едет за пальцем; довел до трети
// ширины или бросил быстро — уезжает вправо и срабатывает тот же onBack, что у
// кнопки «‹»; отпустил раньше — возвращается на место. От середины жест строже:
// явная горизонталь и не поверх того, что само ездит вбок (поле, ползунок, ручка,
// пролистанный ряд чипов) — lib/screenNav.js `swipeAxis`/`swipeBackBlocked`.
//
// Двигаем `left` (экран — position:relative), а НЕ transform: transform сделал бы
// экран containing block для position:fixed потомков, и липкие бары прыгали бы
// (см. комментарий к .screen-anim в index.css).
//
// Мягкость (fb_37f0c1a8): скорость пальца сглажена по последним ~80 мс, доезд после
// отпускания идет со скоростью пальца и тормозит (время и кривая — `settleMotion`),
// подложка подъезжает слева с параллаксом и светлеет (`underlayShift`/`underlayDim`).
// Подложку двигаем тоже `left`/`right`: она absolute, transform поломал бы ее fixed-потомков.
//
// containerRef — скроллер (.content, на нем слушаем касания), screenRef — сам
// экран (.screen-anim). Решения по жесту — чистые функции lib/screenNav.js.
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import {
  EDGE_PX, edgeSwipeSupported, flickVelocity, gestureNow, pushReleaseSample, pushSample, releaseVelocity, settleMotion, swipeAxis, swipeBackBlocked, swipeCommits,
  textSelectionActive, underlayDim, underlayShift,
} from '../lib/screenNav.js'
import { isIOSDevice } from '../lib/pushSupport.js'
import { logSwipe } from '../lib/swipeLog.js'

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// Включать ли свайп назад на этом устройстве: только iOS «на экране Домой»
// (lib/screenNav.js edgeSwipeSupported). Общая проверка для экранов (useAppNav) и
// листов (SheetDialog swipeBack, v8.1.1).
export function edgeSwipeAvailable() {
  try {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
    return edgeSwipeSupported({ isIOS: isIOSDevice(navigator), standalone })
  } catch { return false }
}

export function useEdgeSwipeBack(containerRef, screenRef, onBack, enabled) {
  // Свежий onBack без переподписки слушателей на каждый рендер.
  const backRef = useRef(onBack)
  useEffect(() => { backRef.current = onBack }, [onBack])

  useEffect(() => {
    const box = containerRef?.current
    if (!enabled || !box) return undefined

    let g = null // { x0, y0, edge, axis, dx, samples, width, preview }
    let settleTimer = null
    let settling = false
    let previewStack = null
    let oldOverflow = ''
    let draggedScreen = null
    let underlay = null // запоминаем элемент: после «Назад» он уже не .nav-underlay

    const screen = () => draggedScreen || screenRef.current
    // px — сдвиг экрана; motion — { ms, easing } доезда или null (за пальцем).
    const setLeft = (px, motion, width) => {
      const el = screen()
      if (!el) return
      const tr = motion && !reducedMotion() ? `${motion.ms}ms ${motion.easing}` : null
      el.style.transition = tr ? `left ${tr}` : 'none'
      el.style.left = px ? `${px}px` : ''
      if (underlay && previewStack) {
        const shift = underlayShift(px, width)
        underlay.style.transition = tr ? `left ${tr}, right ${tr}` : 'none'
        underlay.style.left = `${shift}px`
        underlay.style.right = `${-shift}px`
        previewStack.style.setProperty('--swipe-dim-tr', tr ? `opacity ${tr}` : 'none')
        previewStack.style.setProperty('--swipe-dim', String(underlayDim(px, width)))
      }
    }
    // Доезд до target (0 — на место, width — «Назад») со скоростью пальца, потом after.
    const settle = (from, target, v, width, after) => {
      const motion = settleMotion(target - from, target > from ? v : -v)
      settling = true
      setLeft(target, motion, width)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(after, motion.ms)
    }
    const clear = () => {
      const el = draggedScreen
      // edge-settled вместо голого снятия edge-dragging: иначе у экрана снова включалась анимация въезда
      // (.screen-anim--push, left 44px → 0) и после «вернулся» он отскакивал вправо и въезжал заново —
      // «свайп подпрыгивает» везде, кроме тренировки, у которой этой анимации нет (fb_39b706ad / fb_d5c13f18).
      // Класс живет до следующей смены className React-ом — то есть до новой навигации.
      if (el) { el.style.transition = ''; el.style.left = ''; el.classList.remove('edge-dragging'); el.classList.add('edge-settled') }
      draggedScreen = null
      if (underlay) {
        underlay.style.transition = ''
        underlay.style.left = ''
        underlay.style.right = ''
        underlay = null
      }
      if (previewStack) {
        delete previewStack.dataset.swiping
        for (const k of ['--swipe-under-top', '--swipe-height', '--swipe-dim', '--swipe-dim-tr']) previewStack.style.removeProperty(k)
        box.style.overflowY = oldOverflow
        previewStack = null
      }
      settling = false
    }
    const finishBack = () => {
      // Подложка остается видимой до commit: иначе между кадрами вспыхивает
      // уходящий экран. Cleanup очищает именно его, а не новый screenRef.
      flushSync(() => backRef.current?.())
      clear()
    }

    const revealParent = () => {
      const stack = screen()?.parentElement
      const parent = stack?.querySelector(':scope > .nav-underlay')
      if (!parent) return false
      previewStack = stack
      underlay = parent
      oldOverflow = box.style.overflowY
      box.style.overflowY = 'hidden'
      const parentScroll = Number(parent.dataset.scrollTop || 0)
      stack.style.setProperty('--swipe-under-top', `${box.scrollTop - parentScroll}px`)
      stack.style.setProperty('--swipe-height', `${Math.max(box.scrollTop, parentScroll) + box.clientHeight}px`)
      stack.dataset.swiping = 'true'
      return true
    }

    function onStart(e) {
      if (settling || e.touches.length !== 1) return
      if (g) {
        // Прошлое касание закончилось без touchend у нас: его цель убрали из DOM
        // (тренировка сворачивает карточку при подъеме упражнения, useSortable) —
        // события до скроллера уже не всплыли. Старый жест бросаем, иначе свайп
        // молчал бы до перезагрузки экрана (v8.4.0).
        if (g.axis === 'x') { onCancel(); return }
        g = null
      }

      const t = e.touches[0]
      const edge = t.clientX <= EDGE_PX
      if (!edge && swipeBackBlocked(e.target, box)) return
      if (textSelectionActive(window.getSelection?.())) return // тянут ручки выделения
      g = { x0: t.clientX, y0: t.clientY, edge, axis: null, dx: 0, h0: gestureNow(e), samples: pushSample([], t.clientX, e.timeStamp, gestureNow(e)) }
    }

    function onMove(e) {
      if (!g) return
      if (e.touches.length !== 1) { onCancel(e); return }
      const t = e.touches[0]
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      if (!g.axis) {
        // Долгое нажатие выделило текст, пока палец стоял, — дальше палец ведет
        // выделение, а не экран (v7.5.5).
        if (textSelectionActive(window.getSelection?.())) { g = null; return }
        // Палец уже забрал другой жест под ним (перетаскивание упражнения в
        // тренировке, hooks/useSortable.js, гасит прокрутку) — не наш (v8.4.0).
        if (e.defaultPrevented) { g = null; return }

        g.axis = swipeAxis(dx, dy, g.edge)
        if (g.axis === 'y') { g = null; return }
        if (!g.axis) return
        draggedScreen = screenRef.current
        g.width = box.clientWidth || window.innerWidth
        g.preview = revealParent()
        screen()?.classList.add('edge-dragging')
      }
      // e.cancelable === false — iOS уже отдала палец прокрутке: жест прервут (видно в журнале свайпов).
      if (e.cancelable === false) g.lost = (g.lost ?? 0) + 1
      e.preventDefault() // наш жест: не прокручиваем и не отдаем странице
      g.moves = (g.moves ?? 0) + 1
      const prev = g.samples[g.samples.length - 1]
      pushSample(g.samples, t.clientX, e.timeStamp, gestureNow(e))
      // Для журнала (fb_39b706ad): пик скорости и самый дальний сдвиг за ВЕСЬ жест — окно скорости видит лишь
      // последние 80 мс, и «вернулся · 17% · 0 / 0» не говорит, был ли палец дальше и быстрее.
      if (prev && e.timeStamp > prev.t) g.peak = Math.max(g.peak ?? 0, (t.clientX - prev.x) / (e.timeStamp - prev.t))
      g.dx = Math.min(Math.max(0, dx), g.width)
      g.maxDx = Math.max(g.maxDx ?? 0, g.dx)
      if (g.preview && !reducedMotion()) setLeft(g.dx, null, g.width)
    }

    function onEnd(e) {
      if (!g) return
      const done = g
      g = null
      if (done.axis !== 'x') return
      const now = gestureNow(e)
      const last = done.samples[done.samples.length - 1]
      // Отрыв пальца — последняя точка жеста (pushReleaseSample): иначе на тяжелом экране бросок терялся.
      const end = e.changedTouches?.[0]
      if (end) {
        pushReleaseSample(done.samples, end.clientX, e.timeStamp, now)
        done.dx = Math.min(Math.max(0, end.clientX - done.x0), done.width)
      }
      const v = releaseVelocity(done.samples, now)
      const flick = flickVelocity(done.samples, now)
      const commit = swipeCommits(done.dx, Math.max(v, flick), done.width)
      logSwipe({ kind: commit ? 'commit' : 'back', p: done.dx / (done.width || 1), v, flick, moves: done.moves,
        ms: Math.round(now - done.h0), lag: last ? Math.round(now - last.h) : 0,
        max: Math.max(done.maxDx ?? 0, done.dx) / (done.width || 1), peak: done.peak ?? 0,
        why: done.lost ? `прокрутка забирала ${done.lost}` : null })
      if (commit) {
        if (!done.preview || reducedMotion()) { finishBack(); return }
        // Экран уехал — дальше обычная «Назад»: смена tab размонтирует этот экран.
        settle(done.dx, done.width, v, done.width, finishBack)
      } else {
        settle(done.dx, 0, v, done.width, clear)
      }
    }

    function onCancel(e) {
      if (!g) return
      const done = g
      g = null
      if (done.axis !== 'x') return
      logSwipe({ kind: 'cancel', p: done.dx / (done.width || 1), v: 0, flick: 0, moves: done.moves,
        why: e?.type === 'touchcancel' ? 'touchcancel от системы' : e?.touches?.length > 1 ? 'второй палец' : 'новое касание' })
      settle(done.dx, 0, 0, done.width, clear)
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
      clear() // Внутренний экран может закрыться без размонтирования обертки.
    }
  }, [containerRef, screenRef, enabled])
}
