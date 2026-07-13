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
//  - тап по тосту закрывает его (как раньше);
//  - смахивание вбок (свайп) закрывает — удобно убрать с дороги на телефоне;
//  - hideToast(kind) гасит тост извне. С kind — только тост этого вида: так
//    WorkoutScreen при размонтировании гасит СВОЙ undo-тост (он привязан к экрану:
//    после ухода со страницы его «Отменить» уже мёртв), но НЕ трогает поздравление
//    о рекорде/цели, которое по замыслу должно пережить onBack.
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

// За сколько пикселей смахивания тост уезжает совсем (иначе — пружиной назад).
const SWIPE_DISMISS_PX = 90

export default function Toast() {
  const [toast, setToast] = useState(null)
  const [dx, setDx] = useState(0)          // горизонтальный сдвиг тоста при свайпе
  const [leaving, setLeaving] = useState(false) // фаза «уезжает за экран»
  const timer = useRef(null)               // авто-скрытие по duration
  const leaveTimer = useRef(null)          // размонтирование после анимации ухода
  const drag = useRef(null)                // { startX, moved } активного свайпа
  const movedRef = useRef(false)           // был ли последний жест свайпом (гасим click)
  const toastRef = useRef(null)            // актуальный toast для hide-подписки
  toastRef.current = toast

  const clearTimers = () => { clearTimeout(timer.current); clearTimeout(leaveTimer.current) }

  useEffect(() => {
    const show = (payload) => {
      clearTimers()
      setLeaving(false)
      setDx(0)
      drag.current = null
      setToast(payload)
      timer.current = setTimeout(() => setToast(null), payload?.duration ?? 4500)
    }
    const hide = (kind) => {
      const cur = toastRef.current
      if (!cur) return
      if (kind && cur.kind !== kind) return
      clearTimers()
      setToast(null)
    }
    subs.add(show)
    hideSubs.add(hide)
    return () => {
      subs.delete(show)
      hideSubs.delete(hide)
      clearTimers()
    }
  }, [])

  if (!toast) return null

  const dismiss = () => { clearTimers(); setToast(null) }
  const hasAction = toast.actionLabel && toast.onAction

  // Довести смахивание за край экрана и погасить.
  const flyOut = (dir) => {
    clearTimeout(timer.current)
    setLeaving(true)
    setDx(dir * ((typeof window !== 'undefined' && window.innerWidth) || 400))
    leaveTimer.current = setTimeout(() => setToast(null), 260)
  }

  const onPointerDown = (e) => {
    // Тап по кнопке действия («Отменить») — не свайп.
    if (e.target.closest?.('.toast-action')) return
    drag.current = { startX: e.clientX, moved: false }
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const d = e.clientX - drag.current.startX
    if (!drag.current.moved && Math.abs(d) > 4) {
      drag.current.moved = true
      clearTimeout(timer.current) // на время свайпа паузим авто-скрытие
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    if (drag.current.moved) setDx(d)
  }
  const onPointerUp = () => {
    const st = drag.current
    drag.current = null
    if (!st || !st.moved) { movedRef.current = false; return } // это был тап — сработает onClick
    movedRef.current = true // подавим следующий click (иначе он тоже закроет)
    if (Math.abs(dx) > SWIPE_DISMISS_PX) {
      flyOut(dx > 0 ? 1 : -1)
    } else {
      setDx(0) // пружиной на место (transition в CSS)
      timer.current = setTimeout(() => setToast(null), 2500)
    }
  }
  const onClick = () => {
    if (movedRef.current) { movedRef.current = false; return } // это был свайп, не тап
    dismiss()
  }

  const dragging = drag.current?.moved
  const style = {
    transform: `translateX(calc(-50% + ${dx}px)) translateY(0)`,
    transition: dragging ? 'none' : undefined, // во время тяги — строго за пальцем
    opacity: leaving ? 0 : Math.max(0, 1 - Math.abs(dx) / 380),
    touchAction: 'pan-y',
  }

  return (
    <div
      className={`toast show${toast.raised ? ' raised' : ''}`}
      role="status"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
    >
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
