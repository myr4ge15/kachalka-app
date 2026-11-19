import { useEffect, useRef } from 'react'
import { keyboardLift, keyboardOpen, sheetKeyboardInsets } from '../lib/keyboardLift.js'

export function useFieldViewport() {
  const active = useRef(null)
  useEffect(() => () => active.current?.stop(), [])

  return ({ currentTarget, target: field }) => {
    if (!currentTarget.contains(field) || !field.matches('input:not([type]),input[type="text"],textarea')) return
    const scope = field.closest('.sheet, .workout-screen')
    if (!scope) return
    const baseline = Math.max(active.current?.baseline ?? 0, window.innerHeight)
    active.current?.stop()
    const viewport = window.visualViewport
    const sheet = scope.classList.contains('sheet')
    const scroll = field.closest('.sheet-scroll, .content')
    let frame, timer
    const reset = () => {
      delete scope.dataset.fieldViewport
      scope.style.removeProperty('--field-top')
      scope.style.removeProperty('--field-bottom')
    }
    const measure = () => {
      if (document.activeElement !== field) return
      const height = viewport?.height ?? window.innerHeight
      if (!keyboardOpen({ height }, baseline)) { reset(); return }
      const { top, bottom } = sheetKeyboardInsets(viewport, window.innerHeight)
      scope.dataset.fieldViewport = height < 370 ? 'short' : 'open'
      scope.style.setProperty('--field-top', `${top}px`)
      scope.style.setProperty('--field-bottom', `${bottom}px`)
      if (!scroll) return
      const bounds = scroll.getBoundingClientRect()
      const limit = sheet ? bounds.bottom : (scope.querySelector('.wk-save-bar')?.getBoundingClientRect().top ?? bounds.bottom)
      const upper = Math.max(top, bounds.top)
      const lower = Math.min(top + height, bounds.bottom, limit)
      const delta = keyboardLift(field.getBoundingClientRect(), { offsetTop: upper, height: lower - upper }, { margin: 6 })
      if (delta) scroll.scrollTop += delta
    }
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const blur = () => { timer = setTimeout(stop, 250) }
    function stop() {
      cancelAnimationFrame(frame); clearTimeout(timer)
      window.removeEventListener('resize', update)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      field.removeEventListener('blur', blur)
      reset()
      active.current = null
    }
    active.current = { stop, baseline }
    window.addEventListener('resize', update)
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    field.addEventListener('blur', blur)
    update()
  }
}
