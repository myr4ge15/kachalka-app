// Плавающая кнопка «+» (FAB): запись тренировки в один тап с любой основной
// вкладки. Презентационная — решение «показывать или нет» принимает App через
// lib/quickAdd.js (canShowFab), сюда приходит готовый onClick.
//
// Иконка — инлайн-SVG (как TabIcon/SyncIcon, без зависимостей), красится через
// currentColor. Позиционирование/скрытие на десктопе — в CSS (.fab).
export default function AddFab({ onClick }) {
  return (
    <button className="fab" onClick={onClick} aria-label="Записать тренировку" title="Записать тренировку">
      <svg
        className="fab-ico" viewBox="0 0 24 24" width="26" height="26"
        fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" aria-hidden="true"
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    </button>
  )
}
