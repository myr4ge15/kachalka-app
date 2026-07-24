// ============================================================================
// Транзиентный тост (всплывающее уведомление). Минимальный pub/sub, чтобы
// тост пережил размонтирование экрана: WorkoutScreen зовёт showToast() и сразу
// уходит назад (onBack), а сам тост живёт в <Toast/> на уровне App.
//
// Сейчас используется для поздравления с новым личным рекордом после сохранения
// тренировки (ТЗ §4.5) и для undo-тоста при удалении подхода/упражнения. Можно
// переиспользовать для любых коротких сообщений.
//
// Поведение закрытия:
//  - авто-скрытие по duration (по умолчанию 4.5 c);
//  - кнопка действия («Отменить») закрывает тост после срабатывания;
//  - hideToast(kind) гасит тост извне. С kind — только тост этого вида: так
//    WorkoutScreen при размонтировании гасит СВОЙ undo-тост (он привязан к экрану:
//    после ухода со страницы его «Отменить» уже мёртв), но НЕ трогает поздравление
//    о рекорде/цели, которое по замыслу должно пережить onBack.
//
// ВАЖНО (скролл): тост — фиксированная полоса у нижнего края, поверх .content
// (единственная прокручиваемая область), но ВНЕ её. Раньше он ловил pointer-события
// (тап/свайп-закрытие) и потому СЪЕДАЛ вертикальный скролл в своей зоне — палец,
// попавший на тост, не мог прокрутить страницу тренировки. Теперь сам тост
// pointer-transparent (`pointer-events:none` в CSS), интерактивна ТОЛЬКО кнопка
// действия (`pointer-events:auto`) — вертикальные касания проваливаются на .content
// под тостом, и страница скроллится как обычно. Тап/свайп-по-телу для закрытия убраны
// осознанно (тост и так авто-скрывается, а у undo есть явная «Отменить»).
// ============================================================================
import { useEffect, useRef, useState } from 'react'

const subs = new Set()
const hideSubs = new Set()

// Показать тост. payload: { title, sub?, emoji?, actionLabel?, onAction?, duration?, raised?, kind? }.
// Если задан actionLabel+onAction — рисуется кнопка действия (напр. «Отменить»).
// raised:true поднимает тост выше липкой кнопки «Сохранить» композера тренировки
// (иначе undo-тост удаления перекрывает её, пока висит окно отмены).
// kind — необязательная метка вида тоста для адресного hideToast(kind).
export function showToast(payload) {
  for (const fn of subs) {
    try { fn(payload) } catch { /* ignore */ }
  }
}

// Скрыть текущий тост извне. Без kind — гасим любой; с kind — только если показан
// тост этого вида (иначе не трогаем, чтобы не сбить чужой тост).
export function hideToast(kind) {
  for (const fn of hideSubs) {
    try { fn(kind) } catch { /* ignore */ }
  }
}

export default function Toast() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)               // авто-скрытие по duration
  const toastRef = useRef(null)            // актуальный toast для hide-подписки
  toastRef.current = toast

  useEffect(() => {
    const show = (payload) => {
      clearTimeout(timer.current)
      setToast(payload)
      timer.current = setTimeout(() => setToast(null), payload?.duration ?? 4500)
    }
    const hide = (kind) => {
      const cur = toastRef.current
      if (!cur) return
      if (kind && cur.kind !== kind) return
      clearTimeout(timer.current)
      setToast(null)
    }
    subs.add(show)
    hideSubs.add(hide)
    return () => {
      subs.delete(show)
      hideSubs.delete(hide)
      clearTimeout(timer.current)
    }
  }, [])

  if (!toast) return null

  const dismiss = () => { clearTimeout(timer.current); setToast(null) }
  const hasAction = toast.actionLabel && toast.onAction

  return (
    <div className={`toast show${toast.raised ? ' raised' : ''}`} role="status">
      <span className="toast-emoji" aria-hidden="true">{toast.emoji ?? '🏆'}</span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.sub && <div className="toast-sub">{toast.sub}</div>}
      </div>
      {hasAction && (
        <button
          className="toast-action"
          onClick={() => { toast.onAction(); dismiss() }}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  )
}
