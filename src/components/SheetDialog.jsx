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

// Стек открытых листов: Escape закрывает только верхний (лист поверх листа —
// например, подтверждение поверх пикера), а не все разом.
const openStack = []
// Узлы, которым inert поставили МЫ: снимаем только их, чужой inert не трогаем.
const frozenByUs = new Set()

// Фон под листом — inert (РЕВЬЮ-КОДА-2026-10-02): aria-modal сам по себе не мешает
// скринридеру и Tab-у уйти в приложение под затемнением. Замораживаем всех соседей
// ВЕРХНЕГО листа в body (включая нижние листы) и пересчитываем при каждом
// открытии/закрытии — так два листа, смонтированные одним коммитом, не
// замораживают друг друга.
function syncInert() {
  frozenByUs.forEach((el) => el.removeAttribute('inert'))
  frozenByUs.clear()
  // Фон под листом не прокручивается (v6.11.1): inert блокирует клики и фокус, но
  // не жест прокрутки — на iPhone под «Что нового» скроллился экран. Пока открыт
  // хоть один лист, CSS по html[data-sheet-open] замораживает .content.
  const root = document.documentElement
  if (openStack.length) root.dataset.sheetOpen = '1'
  else delete root.dataset.sheetOpen
  const top = openStack[openStack.length - 1]?.overlay
  if (!top?.parentNode) return
  for (const el of top.parentNode.children) {
    if (el === top || el.hasAttribute('inert')) continue
    el.setAttribute('inert', '')
    frozenByUs.add(el)
  }
}

// Общая семантика нижнего листа: modal dialog, Escape, удержание фокуса и
// возврат на кнопку-источник после закрытия. Визуальная геометрия остается у
// существующих .overlay/.sheet в index.css.
export default function SheetDialog({
  title,
  actionLabel = 'закрыть',
  onDismiss,
  dismissDisabled = false,
  className = '',
  children,
}) {
  const titleId = useId()
  const sheetRef = useRef(null)
  // Захватываем источник ДО commit: React успевает применить autoFocus дочернего
  // поля раньше useEffect, и чтение activeElement внутри эффекта уже вернуло бы
  // само поле диалога вместо кнопки, которая его открыла.
  const returnToRef = useRef(typeof document !== 'undefined' ? document.activeElement : null)
  const overlayRef = useRef(null)

  function dismiss() {
    if (!dismissDisabled) onDismiss?.()
  }
  // Последняя версия dismiss для слушателя на document: он вешается один раз,
  // а onDismiss/dismissDisabled меняются между рендерами.
  const dismissRef = useRef(dismiss)
  useEffect(() => { dismissRef.current = dismiss })

  useEffect(() => {
    const returnTo = returnToRef.current
    const sheet = sheetRef.current
    const overlay = overlayRef.current
    const initial = sheet?.querySelector('[data-autofocus]') ?? sheet?.querySelector(FOCUSABLE)
    // React уже применяет autoFocus дочернего поля во время commit. Не фокусируем
    // его повторно из эффекта: в iOS PWA второй программный focus может оставить
    // вложенный scroll-контейнер листа без touch-scroll до реального тапа по полю.
    if (!sheet?.contains(document.activeElement)) initial?.focus()

    // Escape — на document, а не на оверлее (РЕВЬЮ-КОДА-2026-10-02): если фокус
    // потерялся (тап по пустому месту листа, body после удаления узла), keydown
    // до оверлея не доходил и лист не закрывался.
    const token = { overlay }
    openStack.push(token)
    syncInert()
    function onDocKeyDown(event) {
      if (event.key !== 'Escape' || openStack[openStack.length - 1] !== token) return
      event.preventDefault()
      dismissRef.current()
    }
    document.addEventListener('keydown', onDocKeyDown)
    // Жест по затемнению (вне листа) не должен уходить в прокрутку страницы.
    // Только по самой подложке: внутри листа свои прокручиваемые списки.
    function onBackdropMove(event) {
      if (event.target === overlay && event.cancelable) event.preventDefault()
    }
    overlay?.addEventListener('touchmove', onBackdropMove, { passive: false })

    return () => {
      document.removeEventListener('keydown', onDocKeyDown)
      overlay?.removeEventListener('touchmove', onBackdropMove)
      const at = openStack.indexOf(token)
      if (at !== -1) openStack.splice(at, 1)
      // Сначала снимаем inert: в inert-поддереве фокус не ставится.
      syncInert()
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus()
    }
  }, [])

  function onKeyDown(event) {
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
    <div ref={overlayRef} className="overlay" onClick={dismiss} onKeyDown={onKeyDown}>
      <div
        ref={sheetRef}
        className={className ? `sheet ${className}` : 'sheet'}
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
