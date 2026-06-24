// ============================================================================
// Транзиентный тост (всплывающее уведомление). Минимальный pub/sub, чтобы
// тост пережил размонтирование экрана: WorkoutScreen зовёт showToast() и сразу
// уходит назад (onBack), а сам тост живёт в <Toast/> на уровне App.
//
// Сейчас используется для поздравления с новым личным рекордом после сохранения
// тренировки (ТЗ §4.5). Можно переиспользовать для любых коротких сообщений.
// ============================================================================
import { useEffect, useRef, useState } from 'react'

const subs = new Set()

// Показать тост. payload: { title, sub? }.
export function showToast(payload) {
  for (const fn of subs) {
    try { fn(payload) } catch { /* ignore */ }
  }
}

export default function Toast() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    const fn = (payload) => {
      setToast(payload)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setToast(null), 4500)
    }
    subs.add(fn)
    return () => {
      subs.delete(fn)
      clearTimeout(timer.current)
    }
  }, [])

  if (!toast) return null

  return (
    <div className="toast show" role="status" onClick={() => setToast(null)}>
      <span className="toast-emoji" aria-hidden="true">🏆</span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.sub && <div className="toast-sub">{toast.sub}</div>}
      </div>
    </div>
  )
}
