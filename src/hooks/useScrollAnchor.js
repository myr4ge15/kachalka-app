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
// несколько кадров подряд (~1 с), а не один раз. Палец/колесо пользователя
// останавливают подгонку — с ним не спорим.
const RESTORE_MS = 1000

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
      const top = anchorTarget(snap, {
        scrollTop: sc.scrollTop,
        elTop: el ? el.getBoundingClientRect().top : null,
        containerTop: sc.getBoundingClientRect().top,
        maxScroll: sc.scrollHeight - sc.clientHeight,
      })
      if (Math.abs(top - sc.scrollTop) > 1) sc.scrollTop = top
      if (performance.now() - started > RESTORE_MS) stop()
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
