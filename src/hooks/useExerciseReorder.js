import { useEffect, useRef } from 'react'

// Touch listeners are non-passive only to stop scrolling AFTER the hold.
// Before the hold a normal swipe cancels sorting and scrolls the page as usual.
export function useExerciseReorder(onMove) {
  const listRef = useRef(null)
  const moveRef = useRef(onMove)
  moveRef.current = onMove
  useEffect(() => {
    const root = listRef.current
    if (!root) return undefined
    let pending = null, timer = null, frame = null, suppressUntil = 0
    const rows = () => [...root.querySelectorAll('[data-exercise-id]')]
    function marker(y) {
      const others = rows().filter(el => el !== pending.row)
      const before = others.find(el => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2 })
      rows().forEach(el => el.classList.remove('exercise-drop-before', 'exercise-drop-after'))
      if (before) before.classList.add('exercise-drop-before')
      else others.at(-1)?.classList.add('exercise-drop-after')
      pending.beforeId = before?.dataset.exerciseId ?? null
    }
    function scroll() {
      if (!pending?.active) return
      const scroller = root.closest('.content')
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        const delta = pending.y < r.top + 64 ? -8 : pending.y > r.bottom - 88 ? 8 : 0
        if (delta) { scroller.scrollTop += delta; marker(pending.y) }
      }
      frame = requestAnimationFrame(scroll)
    }
    function finish(commit = false) {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      const p = pending
      pending = null
      rows().forEach(el => el.classList.remove('exercise-dragging', 'exercise-drop-before', 'exercise-drop-after'))
      if (p?.active) {
        suppressUntil = Date.now() + 500
        if (commit) moveRef.current(p.id, p.beforeId)
      }
    }
    function start(target, x, y, kind) {
      if (pending) { finish(); return }
      if (!target.closest('.exercise-compact-toggle, .exercise-title')) return
      const row = target.closest('[data-exercise-id]')
      if (!row || rows().length < 2) return
      pending = { row, id: row.dataset.exerciseId, x, y, initialY: y, kind, active: false }
      timer = setTimeout(() => {
        if (!pending) return
        pending.active = true
        row.classList.add('exercise-dragging')
        marker(pending.y)
        frame = requestAnimationFrame(scroll)
      }, 350)
    }
    function move(e, x, y) {
      if (!pending) return
      if (!pending.active) {
        if (Math.hypot(x - pending.x, y - pending.initialY) > 8) finish()
        return
      }
      if (e.cancelable) e.preventDefault()
      pending.y = y
      marker(y)
    }
    const touchStart = e => {
      if (e.touches.length !== 1) { finish(); return }
      const t = e.touches[0]; start(e.target, t.clientX, t.clientY, 'touch')
    }
    const touchMove = e => {
      if (e.touches.length !== 1) { finish(); return }
      const t = e.touches[0]; move(e, t.clientX, t.clientY)
    }
    const touchEnd = e => { if (pending?.active && e.cancelable) e.preventDefault(); finish(true) }
    const cancel = () => finish()
    const pointerDown = e => { if (e.pointerType === 'mouse' && e.button === 0) start(e.target, e.clientX, e.clientY, 'mouse') }
    const pointerMove = e => { if (pending?.kind === 'mouse') move(e, e.clientX, e.clientY) }
    const pointerUp = () => { if (pending?.kind === 'mouse') finish(true) }
    const click = e => { if (Date.now() < suppressUntil) { e.preventDefault(); e.stopPropagation() } }
    const context = e => { if (pending) e.preventDefault() }
    const key = e => {
      if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
      if (!e.target.closest('.exercise-compact-toggle, .exercise-title')) return
      const list = rows(), row = e.target.closest('[data-exercise-id]'), from = list.indexOf(row)
      const to = from + (e.key === 'ArrowUp' ? -1 : 1)
      if (from < 0 || to < 0 || to >= list.length) return
      e.preventDefault()
      const before = e.key === 'ArrowUp' ? list[to] : list[to + 1]
      moveRef.current(row.dataset.exerciseId, before?.dataset.exerciseId ?? null)
    }
    root.addEventListener('touchstart', touchStart, { passive: true })
    root.addEventListener('touchmove', touchMove, { passive: false })
    root.addEventListener('touchend', touchEnd, { passive: false })
    root.addEventListener('touchcancel', cancel)
    root.addEventListener('pointerdown', pointerDown)
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('blur', cancel)
    root.addEventListener('click', click, true)
    root.addEventListener('contextmenu', context)
    root.addEventListener('keydown', key)
    return () => {
      finish()
      root.removeEventListener('touchstart', touchStart)
      root.removeEventListener('touchmove', touchMove)
      root.removeEventListener('touchend', touchEnd)
      root.removeEventListener('touchcancel', cancel)
      root.removeEventListener('pointerdown', pointerDown)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('blur', cancel)
      root.removeEventListener('click', click, true)
      root.removeEventListener('contextmenu', context)
      root.removeEventListener('keydown', key)
    }
  }, [])
  return listRef
}
