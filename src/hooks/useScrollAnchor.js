import { useEffect } from 'react'
import { makeAnchor, anchorTarget } from '../lib/scrollAnchor.js'

// Снять якорь в скроллере: элемент [data-anchor=key] и его отступ (v6.7.1).
export function captureAnchor(container, key) {
  if (!container) return null
  const el = key ? container.querySelector(`[data-anchor="${CSS.escape(key)}"]`) : null
  const cTop = container.getBoundingClientRect().top
  return makeAnchor(el ? key : null, el ? el.getBoundingClientRect().top : cTop, cTop, container.scrollTop)
}

// Вернуть скроллер к якорю после возврата на экран. Контент дорисовывается
// асинхронно (кэш Ленты, рейтинг над постами, въезд экрана), поэтому подгоняем
// несколько кадров подряд (~1 с, или snap.ms — пуш ждет холодного старта), а не один раз. Палец/колесо пользователя
// останавливают подгонку — с ним не спорим.
const RESTORE_MS = 1000

// Видимая высота скроллера: низ .content уходит под плавающее нижнее меню (.tabbar, position: fixed),
// и середина «под меню» — ниже середины того, что видно. Меню нет или оно скрыто (десктоп) — вся высота.
export function visibleHeight(sc, scBox = sc.getBoundingClientRect()) {
  const bar = sc.ownerDocument?.querySelector('.tabbar')
  const b = bar?.getBoundingClientRect()
  if (!b || !(b.height > 0)) return sc.clientHeight
  const covered = Math.max(0, Math.min(scBox.bottom, scBox.top + sc.clientHeight) - b.top)
  return Math.max(0, sc.clientHeight - covered)
}

export function useScrollAnchorRestore(containerRef, snap, onDone) {
  useEffect(() => {
    const sc = containerRef.current
    if (!sc || !snap) return undefined
    let raf = 0
    let stopped = false
    const started = performance.now()
    const stop = () => {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(raf)
      sc.removeEventListener('touchstart', stop)
      sc.removeEventListener('wheel', stop)
      onDone?.()
    }
    const tick = () => {
      if (stopped) return
      const el = snap.anchor ? sc.querySelector(`[data-anchor="${CSS.escape(snap.anchor)}"]`) : null
      // Центрируем весь блок якоря ([data-anchor-box] — карточка Ленты), а не сам якорь: им служит
      // шапка карточки, и по ее высоте карточка вставала верхом в середину экрана, свисая вниз (fb_654fe23d).
      const target = el && snap.center ? (el.closest('[data-anchor-box]') ?? el) : el
      const box = target ? target.getBoundingClientRect() : null
      const scBox = sc.getBoundingClientRect()
      const top = anchorTarget(snap, {
        scrollTop: sc.scrollTop,
        elTop: box ? box.top : null,
        containerTop: scBox.top,
        maxScroll: sc.scrollHeight - sc.clientHeight,
        elHeight: box ? box.height : 0,
        viewHeight: snap.center ? visibleHeight(sc, scBox) : sc.clientHeight,
      })
      if (Math.abs(top - sc.scrollTop) > 1) sc.scrollTop = top
      if (performance.now() - started > (snap.ms ?? RESTORE_MS)) stop()
      else raf = requestAnimationFrame(tick)
    }
    sc.addEventListener('touchstart', stop, { passive: true })
    sc.addEventListener('wheel', stop, { passive: true })
    raf = requestAnimationFrame(tick)
    return stop
    // onDone — колбэк гашения интента; его смена не должна перезапускать подгонку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, snap])
}
