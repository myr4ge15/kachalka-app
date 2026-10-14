import { useRef } from 'react'

// Тап по полю подхода выделяет значение целиком: новое число сразу заменяет старое
// (просьба владельца 14.10.2026 — курсор «лез в середину» короткого числа по центру поля).
// Тонкость iOS/Safari: каретку по месту тапа браузер ставит ПОСЛЕ focus — на mouseup.
// Поэтому выделяем на focus и гасим mouseup ТОГО ЖЕ тапа; следующий тап по уже
// сфокусированному полю ставит курсор, как обычно (поправить одну цифру можно).
export function selectAll(el) {
  if (!el || el.ownerDocument?.activeElement !== el) return
  try {
    el.setSelectionRange(0, String(el.value ?? '').length)
  } catch {
    el.select?.() // поля без API выделения (type=number и т. п.)
  }
}

export function useSelectOnFocus({ onFocus, onMouseUp } = {}) {
  const justFocused = useRef(false)
  return {
    onFocus(e) {
      onFocus?.(e)
      const el = e.currentTarget
      justFocused.current = true
      selectAll(el)
      // Значение могло смениться в onFocus (TimeInput переписывает его в «мм:сс»)
      setTimeout(() => selectAll(el), 0)
    },
    onMouseUp(e) {
      onMouseUp?.(e)
      if (!justFocused.current) return
      justFocused.current = false
      e.preventDefault()
    },
    onBlur() {
      justFocused.current = false
    },
  }
}
