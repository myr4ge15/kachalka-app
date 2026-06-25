// ============================================================================
// Транзиентный тост (всплывающее уведомление). Минимальный pub/sub, чтобы
// тост пережил размонтирование экрана: WorkoutScreen зовёт showToast() и сразу
// уходит назад (onBack), а сам тост живёт в <Toast/> на уровне App.
//
// Сейчас используется для поздравления с новым личным рекордом после сохранения
// тренировки (ТЗ §4.5) и для undo-тоста при удалении подхода/упражнения. Можно
// переиспользовать для любых коротких сообщений.
// ============================================================================
import { useEffect, useRef, useState } from 'react'

const subs = new Set()

// Показать тост. payload: { title, sub?, emoji?, actionLabel?, onAction?, duration? }.
// Если задан actionLabel+onAction — рисуется кнопка действия (напр. «Отменить»).
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
      timer.current = setTimeout(() => setToast(null), payload?.duration ?? 4500)
    }
    subs.add(fn)
    return () => {
      subs.delete(fn)
      clearTimeout(timer.current)
    }
  }, [])

  if (!toast) return null

  const dismiss = () => { clearTimeout(timer.current); setToast(null) }
  const hasAction = toast.actionLabel && toast.onAction

  return (
    <div className="toast show" role="status" onClick={dismiss}>
      <span className="toast-emoji" aria-hidden="true">{toast.emoji ?? '🏆'}</span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.sub && <div className="toast-sub">{toast.sub}</div>}
      </div>
      {hasAction && (
        <button
          className="toast-action"
          onClick={(e) => { e.stopPropagation(); toast.onAction(); dismiss() }}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  )
}
