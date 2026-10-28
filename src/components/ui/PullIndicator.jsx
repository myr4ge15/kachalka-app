import { PULL_THRESHOLD } from '../../lib/pullRefresh.js'

// Индикатор жеста «потянуть вниз» (hooks/usePullToRefresh.js): компактный круглый бейдж, выплывает из-за
// верхнего края и доворачивает стрелку по мере протягивания; на пороге — «готов» (акцент), во время
// обновления — крутится. Сам экран НЕ двигаем — контент стоит на месте. Родитель — с position: relative.
export default function PullIndicator({ pull, dragging, busy }) {
  if (!busy && !(pull > 0)) return null
  const progress = Math.min(pull / PULL_THRESHOLD, 1)
  const y = busy ? 8 : -40 + progress * 48 // px: из-за края в зону видимости
  const ready = busy || pull >= PULL_THRESHOLD
  return (
    <div
      className={'ptr' + (ready ? ' ready' : '') + (busy ? ' loading' : '')}
      aria-hidden="true"
      style={{
        transform: `translate(-50%, ${y}px)`,
        opacity: busy ? 1 : progress,
        transition: dragging ? 'none' : 'transform var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)',
      }}
    >
      <span className="ptr-ico" style={!busy && pull ? { transform: `rotate(${progress * 180}deg)` } : undefined}>
        {/* SVG, а не текстовые ↻/↓: у глифов своя базовая линия, при вращении они «гуляли» (UI-ревью 23.10). */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {busy
            ? <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></>
            : <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>}
        </svg>
      </span>
    </div>
  )
}
