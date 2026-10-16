import { Suspense, lazy, useRef, useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import { WELCOME_STEPS, swipeOutcome } from '../../lib/welcome.js'

// Инструкция — отдельный чанк: текст нужен, только если ее открыли.
const QuickStartSheet = lazy(() => import('./QuickStartSheet.jsx'))

// Лист «Добро пожаловать» (v6.15.0): один раз после регистрации по приглашению —
// 4 карточки о главном (lib/welcome.js WELCOME_STEPS), листаются «Дальше», свайпом
// или точками. На последней — «Записать первую тренировку» (сразу композер) и
// неприметная ссылка на «Быстрый старт» — с v6.16.0 он открывается листом внутри
// приложения (QuickStartSheet), а не страницей на GitHub.
// Пропсы: onStart() — закрыть и открыть новую тренировку; onClose() — закрыть.
// Карусель (16.10, обращение fb_a0994990): карточка едет за пальцем (только горизонтальный
// жест — вертикаль остается прокрутке, touch-action: pan-y), отпустил — листается по
// swipeOutcome или возвращается на место; у краев — упругое сопротивление. Новая карточка
// въезжает со стороны листания (.welcome-in-next / -prev, без анимации при reduced-motion).
export default function WelcomeSheet({ onStart, onClose }) {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(null) // 'next' | 'prev' — откуда въезжает текущая карточка
  const [guide, setGuide] = useState(false)
  const gesture = useRef(null)
  const cardRef = useRef(null)
  const total = WELCOME_STEPS.length
  const s = WELCOME_STEPS[step]
  const last = step === total - 1

  function go(next) {
    if (next === step || next < 0 || next >= total) return
    setDir(next > step ? 'next' : 'prev')
    setStep(next)
  }
  function shift(px, animate) {
    const el = cardRef.current
    if (!el) return
    el.style.transition = animate ? 'transform var(--dur-fast) var(--ease-out)' : 'none'
    el.style.transform = px ? `translateX(${px}px)` : ''
  }
  function onTouchStart(e) {
    const t = e.touches?.[0]
    gesture.current = t ? { x0: t.clientX, y0: t.clientY, t0: Date.now(), axis: null, dx: 0, dy: 0 } : null
  }
  function onTouchMove(e) {
    const g = gesture.current
    const t = e.touches?.[0]
    if (!g || !t) return
    g.dx = t.clientX - g.x0
    g.dy = t.clientY - g.y0
    if (!g.axis && Math.max(Math.abs(g.dx), Math.abs(g.dy)) > 8) g.axis = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y'
    if (g.axis !== 'x') return
    const edge = (step === 0 && g.dx > 0) || (last && g.dx < 0)
    shift(edge ? g.dx * 0.3 : g.dx, false)
  }
  function onTouchEnd() {
    const g = gesture.current
    gesture.current = null
    if (!g || g.axis !== 'x') return
    const width = cardRef.current?.getBoundingClientRect().width || 320
    const move = swipeOutcome(g.dx, g.dy, Date.now() - g.t0, width)
    const next = step + move
    if (move && next >= 0 && next < total) go(next)
    else shift(0, true)
  }

  return (
    <>
    <SheetDialog title="Добро пожаловать" actionLabel="закрыть" onDismiss={() => onClose?.()} className="sheet--compact">
      <div key={step} ref={cardRef} className={'welcome-card' + (dir ? ` welcome-in-${dir}` : '')}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
        aria-live="polite">
        <span className="welcome-em" aria-hidden="true">{s.e}</span>
        <p className="welcome-title">{s.title}</p>
        <p className="welcome-text">{s.text}</p>
        {last && (
          <button type="button" className="link-btn welcome-more" onClick={() => setGuide(true)}>
            Подробная инструкция ›
          </button>
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
            onClick={() => go(i)}
          />
        ))}
      </div>
      {last ? (
        <button type="button" className="btn primary full welcome-go" onClick={() => onStart?.()} data-autofocus>
          Записать первую тренировку
        </button>
      ) : (
        <button type="button" className="btn primary full welcome-go" onClick={() => go(step + 1)} data-autofocus>
          Дальше
        </button>
      )}
      <button type="button" className="link-btn welcome-skip" onClick={() => onClose?.()}>
        {last ? 'Сначала осмотрюсь' : 'Пропустить'}
      </button>
    </SheetDialog>
    {guide && (
      <Suspense fallback={null}>
        <QuickStartSheet onClose={() => setGuide(false)} />
      </Suspense>
    )}
    </>
  )
}
