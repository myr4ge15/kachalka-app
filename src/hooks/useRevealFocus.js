import { useEffect, useRef } from 'react'

// Общий контракт для пользовательских раскрытий/переключений: после commit
// React новый блок оказывается в центре ближайшего скроллера. Пустой trigger
// означает начальную загрузку или закрытие — экран в этих случаях не прыгает.
export function useRevealFocus(trigger, { block = 'center' } = {}) {
  const revealRef = useRef(null)

  useEffect(() => {
    if (!trigger) return
    revealRef.current?.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block,
      inline: 'nearest',
    })
  }, [block, trigger])

  return revealRef
}
