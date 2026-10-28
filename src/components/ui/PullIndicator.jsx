import { PULL_THRESHOLD } from '../../lib/pullRefresh.js'

const SIZE = 32 // px, как .ptr в index.css

// Индикатор жеста «потянуть вниз» (hooks/usePullToRefresh.js): круглый бейдж с колесиком. Экран уезжает
// вниз на offset (стиль хука на корне), бейдж стоит по центру открывшегося зазора над ним и доворачивает
// стрелку по мере протягивания; на пороге — «готов» (акцент), во время обновления — крутится.
// Родитель — корень экрана с position: relative.
export default function PullIndicator({ pull, offset, dragging, busy }) {
  if (!busy && !(pull > 0)) return null
  const progress = Math.min(pull / PULL_THRESHOLD, 1)
  const y = -(offset + SIZE) / 2 // центр зазора [-offset, 0] над верхом экрана
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
