// Одна геометрия для переходов и раскрывающихся строк.
export default function Chevron({ open = false, className = '' }) {
  return <svg className={`ui-chevron ${className}`} viewBox="0 0 20 20" width="20" height="20"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" style={open ? { transform: 'rotate(90deg)' } : undefined}>
    <path d="m8 6 4 4-4 4" />
  </svg>
}
