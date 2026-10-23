import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// «⋯» и выпадающее меню под ним (19.10.2026, 9.5.4: комментарии, «Друзья»). Пункты — дети с
// role="menuitem" (обычные <button>). Меню поверх соседей, строки списка не сдвигает. Мало места
// снизу (низ экрана, над таббаром) — раскрывается вверх. Закрывается тапом мимо, Esc и прокруткой.
// Состояние открытия — у вызывающего (одно меню на список): open, onToggle(), onClose().
export default function MoreMenu({ label, open, onToggle, onClose, className = '', btnClassName = '', children }) {
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [up, setUp] = useState(false)

  useLayoutEffect(() => {
    if (!open) return
    const r = btnRef.current?.getBoundingClientRect()
    const menuH = wrapRef.current?.querySelector('[role="menu"]')?.offsetHeight || 120
    setUp(Boolean(r) && window.innerHeight - r.bottom < menuH + 96)
    wrapRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => closeRef.current?.()
    const outside = (e) => { if (!wrapRef.current?.contains(e.target)) close() }
    // Клавиатура (UI-ревью 23.10): Esc закрывает и не уходит дальше (лист под меню не закрывается),
    // стрелки ходят по пунктам по кругу, Tab уводит фокус из меню — меню закрывается, а не висит.
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        close(); btnRef.current?.focus({ preventScroll: true })
        return
      }
      if (e.key === 'Tab') { close(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const items = [...(wrapRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? [])]
      if (!items.length) return
      e.preventDefault()
      const i = items.indexOf(document.activeElement)
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items[next].focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', outside, true)
    }
  }, [open])

  return (
    <div className={`more-wrap ${className}`.trim()} ref={wrapRef}>
      <button type="button" ref={btnRef} className={btnClassName} aria-label={label}
        aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>⋯</button>
      {open && (
        <div className={`more-menu${up ? ' up' : ''}`} role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}
