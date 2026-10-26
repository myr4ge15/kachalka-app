// Одна геометрия для переходов и раскрывающихся строк.
// Аудит 16.10 (🟡-2): текстовые «›» и «⌄/⌃» сидели на базовой линии шрифта и прыгали при
// раскрытии — все стрелки приложения теперь только этот SVG.
//   переход (по умолчанию) — «›», open поворачивает вниз;
//   toggle — раскрытие строки: закрыто «⌄», open — «⌃» (поворот, а не смена символа);
//   inline — внутри ссылки-текста («Подробнее ›»): цвет и размер от текста;
//   back — «‹» (листание назад: месяц в календаре), 26.10.2026 — вместо своих SVG-стрелок в экранах.
export default function Chevron({ open = false, toggle = false, inline = false, back = false, size = 20, className = '' }) {
  const cls = ['ui-chevron', toggle && 'ui-chevron--toggle', inline && 'ui-chevron--inline', back && 'ui-chevron--back', open && 'is-open', className]
    .filter(Boolean).join(' ')
  return <svg className={cls} viewBox="0 0 20 20" width={size} height={size}
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="m8 6 4 4-4 4" />
  </svg>
}
