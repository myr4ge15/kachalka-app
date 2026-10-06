import { useRef, useState } from 'react'
import SheetDialog from './SheetDialog.jsx'
import { QUICK_START_URL, WELCOME_STEPS, stepAfterSwipe } from '../lib/welcome.js'

// Лист «Добро пожаловать» (v6.15.0): один раз после регистрации по приглашению —
// 4 карточки о главном (lib/welcome.js WELCOME_STEPS), листаются «Дальше», свайпом
// или точками. На последней — «Записать первую тренировку» (сразу композер) и
// неприметная ссылка на «Быстрый старт».
// Пропсы: onStart() — закрыть и открыть новую тренировку; onClose() — закрыть.
export default function WelcomeSheet({ onStart, onClose }) {
  const [step, setStep] = useState(0)
  const touchX = useRef(null)
  const total = WELCOME_STEPS.length
  const s = WELCOME_STEPS[step]
  const last = step === total - 1

  function onTouchStart(e) { touchX.current = e.touches?.[0]?.clientX ?? null }
  function onTouchEnd(e) {
    const x = e.changedTouches?.[0]?.clientX
    if (touchX.current != null && x != null) setStep((cur) => stepAfterSwipe(cur, x - touchX.current, total))
    touchX.current = null
  }

  return (
    <SheetDialog title="Добро пожаловать" actionLabel="закрыть" onDismiss={() => onClose?.()} className="sheet--compact">
      <div className="welcome-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-live="polite">
        <span className="welcome-em" aria-hidden="true">{s.e}</span>
        <p className="welcome-title">{s.title}</p>
        <p className="welcome-text">{s.text}</p>
        {last && (
          <a className="welcome-more" href={QUICK_START_URL} target="_blank" rel="noopener noreferrer">
            Подробная инструкция ›
          </a>
        )}
      </div>
      <div className="welcome-dots">
        {WELCOME_STEPS.map((it, i) => (
          <button
            key={it.title}
            type="button"
            className={i === step ? 'welcome-dot on' : 'welcome-dot'}
            aria-label={`Шаг ${i + 1} из ${total}`}
            aria-current={i === step ? 'step' : undefined}
            onClick={() => setStep(i)}
          />
        ))}
      </div>
      {last ? (
        <button type="button" className="btn primary full welcome-go" onClick={() => onStart?.()} data-autofocus>
          Записать первую тренировку
        </button>
      ) : (
        <button type="button" className="btn primary full welcome-go" onClick={() => setStep(step + 1)} data-autofocus>
          Дальше
        </button>
      )}
      <button type="button" className="link-btn welcome-skip" onClick={() => onClose?.()}>
        {last ? 'Осмотрюсь сам' : 'Пропустить'}
      </button>
    </SheetDialog>
  )
}
