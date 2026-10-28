// Колесико жеста «потянуть вниз» (hooks/usePullToRefresh.js): круглый бейдж над экраном. Позицию,
// прозрачность, поворот стрелки и «готов» (акцент) во время жеста пишет хук прямо в DOM через ref — без
// перерисовок React (fb_f8a87f1a); здесь только разметка и иконка: стрелка или крутится (busy).
// Родитель — корень экрана с position: relative. В покое бейдж прозрачен (index.css .ptr).
export default function PullIndicator({ indicatorRef, busy }) {
  return (
    <div ref={indicatorRef} className={'ptr' + (busy ? ' loading' : '')} aria-hidden="true">
      <span className="ptr-ico">
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
