import { fmtRest, restAriaLabel } from '../../lib/restTimer.js'

// Пилюля таймера отдыха рядом с датой композера (v8.8.0, prototypes/rest-timer.html).
// Презентационная: фаза и обработчик — от WorkoutScreen (hooks/useRestTimer.js).
//   idle — «⏱ 1:30» приглушенно, тап — начать отдых;
//   run  — остаток акцентом, заливка растет по мере отдыха, тап — лист таймера;
//   done — «⏱ +0:12» зеленым с пульсом (перебор), тап — новый отдых.
export default function RestPill({ state, idleSec, onTap }) {
  const { phase } = state
  const text = phase === 'run'
    ? fmtRest(state.leftMs, { up: true })
    : phase === 'done' ? `+${fmtRest(state.overMs)}` : fmtRest(idleSec * 1000)
  return (
    <button
      type="button"
      className={`rest-pill is-${phase}`}
      aria-label={restAriaLabel(state, idleSec)}
      onClick={onTap}
    >
      {phase === 'run' && (
        <span className="rest-pill__fill" aria-hidden="true" style={{ transform: `scaleX(${state.progress})` }} />
      )}
      <RestIcon />
      <span className="rest-pill__value">{text}</span>
    </button>
  )
}

export function RestIcon({ size = 15 }) {
  return (
    <svg className="rest-ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 2.5h5" />
    </svg>
  )
}
