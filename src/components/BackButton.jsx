// Круглая кнопка «назад» (редизайн «Спорт-блоки», v6.2.0): одна на все вложенные
// экраны — Шаблоны, Свежесть, Достижения, Каталог, Оформление, админка, запись
// тренировки. Раньше были текстовые «← Назад» / «‹ Назад» зелёным разного вида.
// Подпись — в aria-label (по умолчанию «Назад»), иконка — инлайн-SVG.
export default function BackButton({ onClick, label = 'Назад' }) {
  return (
    <button type="button" className="back-btn" onClick={onClick} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  )
}
