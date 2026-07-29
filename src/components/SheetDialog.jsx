import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// Общая семантика нижнего листа: modal dialog, Escape, удержание фокуса и
// возврат на кнопку-источник после закрытия. Визуальная геометрия остаётся у
// существующих .overlay/.sheet в index.css.
export default function SheetDialog({
  title,
  actionLabel = 'закрыть',
  onDismiss,
  dismissDisabled = false,
  children,
}) {
  const titleId = useId()
  const sheetRef = useRef(null)
  // Захватываем источник ДО commit: React успевает применить autoFocus дочернего
  // поля раньше useEffect, и чтение activeElement внутри эффекта уже вернуло бы
  // само поле диалога вместо кнопки, которая его открыла.
  const returnToRef = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  useEffect(() => {
    const returnTo = returnToRef.current
    const sheet = sheetRef.current
    const initial = sheet?.querySelector('[data-autofocus]') ?? sheet?.querySelector(FOCUSABLE)
    // React уже применяет autoFocus дочернего поля во время commit. Не фокусируем
    // его повторно из эффекта: в iOS PWA второй программный focus может оставить
    // вложенный scroll-контейнер листа без touch-scroll до реального тапа по полю.
    if (!sheet?.contains(document.activeElement)) initial?.focus()
    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus()
    }
  }, [])

  function dismiss() {
    if (!dismissDisabled) onDismiss?.()
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(sheetRef.current?.querySelectorAll(FOCUSABLE) ?? [])]
    if (!focusable.length) {
      event.preventDefault()
      sheetRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="overlay" onClick={dismiss} onKeyDown={onKeyDown}>
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <strong id={titleId}>{title}</strong>
          <button className="link-btn" disabled={dismissDisabled} onClick={dismiss}>
            {actionLabel}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}
