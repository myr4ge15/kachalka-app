// Галочка — одна геометрия для отметок (19.10.2026, fb_d9f26797). Текстовый «✓» сидел на
// базовой линии шрифта и в кружке выбора выглядел сдвинутым — как «›» до Chevron.jsx.
// Цвет — от текста (currentColor), размер — size.
export default function CheckIcon({ size = 16, strokeWidth = 2.6, className = '' }) {
  return <svg className={`ui-check ${className}`.trim()} viewBox="0 0 24 24" width={size} height={size}
    fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
}
