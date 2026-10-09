import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

// Сортировка списка перетаскиванием (v7.1.2) — одна механика для тренировки,
// шаблонов и порядка учеток в Админке.
//
// Как выглядит: взятая строка «поднимается» (тень, чуть крупнее) и едет за
// пальцем, соседи плавно расступаются ровно там, куда она ляжет. На отпускании
// строка доезжает до места, и только тогда порядок уходит в onMove(id, beforeId)
// (beforeId = id строки, перед которой встать; null — в конец). Отмена (второй
// палец, touchcancel, уход окна) — все возвращается на место без onMove.
//
// Во время жеста React не перерисовывается: двигаем строки transform'ом по
// раскладке, снятой в момент подъема. Новый порядок применяется через flushSync
// и только потом снимаются transform'ы — без кадра со старым порядком.
//
// Опции:
//   attr     — атрибут строки с id (строка = любой элемент с этим атрибутом внутри корня);
//   handle   — селектор, за который можно взять строку (и он же — фокус для Alt+↑/↓);
//   holdMs   — удержание до подъема. Больше 0 — тач-скролл до подъема работает как обычно
//              (сдвиг пальца > 8px отменяет). 0 — за ручку (touch-action: none) берется сразу;
//   onLift(id) / onDrop() — до замера раскладки и после конца жеста (тренировка на это
//              время сворачивает раскрытую карточку).
// Тач — touch-события (non-passive, чтобы гасить скролл только ПОСЛЕ подъема), мышь — pointer.
// Клавиатура: Alt+↑/↓ на ручке переставляет на одну позицию сразу.

const DROP_MS = 180 // = --dur-base; «подъем» (scale, тень) — в index.css, .sort-lifted

export function useSortable(onMove, { attr, handle, holdMs = 0, onLift, onDrop } = {}) {
  // callback-ref: корень списка может появиться позже экрана (редактор шаблона).
  const [root, setRoot] = useState(null)
  const cb = useRef({ onMove, onLift, onDrop })
  cb.current = { onMove, onLift, onDrop }
  useEffect(() => {
    if (!root) return undefined
    const sel = `[${attr}]`
    const rows = () => [...root.querySelectorAll(sel)]
    const idOf = el => el.getAttribute(attr)
    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let g = null          // текущий жест
    let timer = null, frame = null, dropTimer = null, suppressUntil = 0

    const scrollerOf = () => root.closest('.content') ?? document.scrollingElement
    const scrollTop = () => g?.scroller?.scrollTop ?? 0

    function lift() {
      g.active = true
      if (cb.current.onLift) flushSync(() => cb.current.onLift(g.id))
      const list = rows()
      const d = list.findIndex(el => idOf(el) === g.id)
      if (d < 0) { reset(); return }
      g.scroller = scrollerOf()
      g.startScroll = scrollTop()
      // Раскладка в координатах содержимого скроллера: переживает автопрокрутку.
      g.list = list
      g.d = d
      g.rects = list.map(el => { const r = el.getBoundingClientRect(); return { top: r.top + g.startScroll, h: r.height } })
      const gaps = g.rects.slice(1).map((r, i) => r.top - (g.rects[i].top + g.rects[i].h)).filter(x => x >= 0)
      g.gap = gaps.length ? gaps.sort((a, b) => a - b)[gaps.length >> 1] : 0
      g.t = d
      root.classList.add('sort-active')
      list.forEach((el, i) => el.classList.add(i === d ? 'sort-lifted' : 'sort-shift'))
      try { navigator.vibrate?.(8) } catch { /* нет вибро — ок */ }
      apply()
      frame = requestAnimationFrame(autoscroll)
    }

    function apply() {
      const { rects, d, list } = g
      const first = rects[0], last = rects.at(-1), me = rects[d]
      let dy = (g.y - g.startY) + (scrollTop() - g.startScroll)
      // Не выпускаем строку за края списка.
      dy = Math.max(first.top - me.top, Math.min(last.top + last.h - me.top - me.h, dy))
      list[d].style.transform = `translate3d(0, ${dy}px, 0)`
      // Сосед уступает место, когда край взятой строки переходит его середину:
      // нижний край — для строк ниже, верхний — для строк выше.
      let t = d
      rects.forEach((r, i) => {
        const mid = r.top + r.h / 2
        if (i > d && me.top + me.h + dy > mid) t++
        if (i < d && me.top + dy < mid) t--
      })
      g.t = t
      const step = me.h + g.gap
      list.forEach((el, i) => {
        if (i === d) return
        const shift = d < i && i <= t ? -step : t <= i && i < d ? step : 0
        el.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : ''
      })
    }

    function autoscroll() {
      if (!g?.active || g.dropping) return
      const sc = g.scroller
      if (sc) {
        const r = sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect()
        const delta = g.y < r.top + 64 ? -8 : g.y > r.bottom - 88 ? 8 : 0
        if (delta) { sc.scrollTop += delta; apply() }
      }
      frame = requestAnimationFrame(autoscroll)
    }

    function clear() {
      root.classList.remove('sort-active')
      for (const el of [...(g?.list ?? []), ...rows()]) {
        el.classList.remove('sort-lifted', 'sort-shift', 'sort-dropping')
        el.style.transform = ''
      }
    }

    function reset() {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      detach()
      g = null
    }

    // Тач-события идут элементу, на котором НАЧАЛОСЬ касание, даже если React его
    // убрал (тренировка сворачивает карточку: заголовок под пальцем пропадает, и
    // touchend до корня уже не всплывет). Поэтому слушаем прямо на нем.
    let touchEl = null
    function attach(el) {
      detach()
      touchEl = el
      el.addEventListener('touchmove', touchMove, { passive: false })
      el.addEventListener('touchend', touchEnd, { passive: false })
      el.addEventListener('touchcancel', cancel)
    }
    function detach() {
      if (!touchEl) return
      touchEl.removeEventListener('touchmove', touchMove)
      touchEl.removeEventListener('touchend', touchEnd)
      touchEl.removeEventListener('touchcancel', cancel)
      touchEl = null
    }

    // Конец жеста: commit — встать на новое место, иначе — вернуться.
    function finish(commit) {
      clearTimeout(timer)
      if (!g || g.dropping) return
      if (!g.active) { reset(); return }
      cancelAnimationFrame(frame)
      detach()
      suppressUntil = Date.now() + 500
      const { rects, d, list } = g
      const t = commit ? g.t : d
      let y = 0
      if (t > d) y = rects[t].top + rects[t].h - (rects[d].top + rects[d].h)
      else if (t < d) y = rects[t].top - rects[d].top
      y -= scrollTop() - g.startScroll // строка уехала вместе с прокруткой
      const others = list.filter((_, i) => i !== d)
      const beforeId = t === d ? undefined : (others[t] ? idOf(others[t]) : null)
      g.dropping = true
      list[d].classList.add('sort-dropping')
      list[d].style.transform = `translate3d(0, ${y}px, 0)`
      if (!commit) list.forEach((el, i) => { if (i !== d) el.style.transform = '' })
      const done = () => {
        const id = g.id
        flushSync(() => {
          if (commit && beforeId !== undefined) cb.current.onMove(id, beforeId)
          cb.current.onDrop?.()
        })
        clear()
        g = null
      }
      const ms = reduced() ? 0 : DROP_MS
      if (ms) dropTimer = setTimeout(done, ms)
      else done()
    }

    function start(target, x, y, kind) {
      if (g) { if (!g.dropping) finish(false); return }
      const h = target.closest?.(handle)
      if (!h || !root.contains(h)) return
      const row = h.closest(sel)
      if (!row || rows().length < 2) return
      g = { id: idOf(row), x, y, startY: y, kind, active: false }
      if (holdMs > 0) timer = setTimeout(() => { if (g && !g.active) lift() }, holdMs)
      else lift()
    }

    function move(e, x, y) {
      if (!g || g.dropping) return
      if (!g.active) {
        if (Math.hypot(x - g.x, y - g.startY) > 8) reset()
        return
      }
      if (e.cancelable) e.preventDefault()
      g.y = y
      apply()
    }

    const touchStart = e => {
      if (e.touches.length !== 1) { finish(false); return }
      const t = e.touches[0]; start(e.target, t.clientX, t.clientY, 'touch')
      if (g && !g.dropping && g.kind === 'touch') attach(e.target)
    }
    const touchMove = e => {
      if (!g) return
      if (e.touches.length !== 1) { finish(false); return }
      const t = e.touches[0]; move(e, t.clientX, t.clientY)
    }
    const touchEnd = e => { if (g?.active && e.cancelable) e.preventDefault(); finish(true) }
    const cancel = () => finish(false)
    const pointerDown = e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (holdMs === 0 && e.target.closest?.(handle)) e.preventDefault() // без выделения текста
      start(e.target, e.clientX, e.clientY, 'mouse')
    }
    const pointerMove = e => { if (g?.kind === 'mouse') move(e, e.clientX, e.clientY) }
    const pointerUp = () => { if (g?.kind === 'mouse') finish(true) }
    const click = e => { if (Date.now() < suppressUntil) { e.preventDefault(); e.stopPropagation() } }
    const context = e => { if (g) e.preventDefault() }
    const key = e => {
      if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || g) return
      const h = e.target.closest?.(handle)
      if (!h || !root.contains(h)) return
      const list = rows(), row = h.closest(sel), from = list.indexOf(row)
      const to = from + (e.key === 'ArrowUp' ? -1 : 1)
      if (from < 0 || to < 0 || to >= list.length) return
      e.preventDefault()
      const before = e.key === 'ArrowUp' ? list[to] : list[to + 1]
      const id = idOf(row)
      flushSync(() => cb.current.onMove(id, before ? idOf(before) : null))
      // Фокус остается на ручке переставленной строки — можно жать дальше.
      rows().find(el => idOf(el) === id)?.querySelector(handle)?.focus()
    }

    root.addEventListener('touchstart', touchStart, { passive: true }) // ручка — touch-action: none
    root.addEventListener('pointerdown', pointerDown)
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('blur', cancel)
    root.addEventListener('click', click, true)
    root.addEventListener('contextmenu', context)
    root.addEventListener('keydown', key)
    return () => {
      clearTimeout(timer)
      clearTimeout(dropTimer)
      cancelAnimationFrame(frame)
      clear()
      g = null
      root.removeEventListener('touchstart', touchStart)
      detach()
      root.removeEventListener('pointerdown', pointerDown)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('blur', cancel)
      root.removeEventListener('click', click, true)
      root.removeEventListener('contextmenu', context)
      root.removeEventListener('keydown', key)
    }
  }, [root, attr, handle, holdMs])
  return setRoot
}
