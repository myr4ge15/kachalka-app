// Кнопка «+» — запись тренировки в один тап. С редизайна «Спорт-блоки» (v6, этап 2)
// это круглая кнопка ПО ЦЕНТРУ нижнего меню (между «Тренировками» и «Лентой»), а не
// плавающая над контентом: внутри меню она ничего не перекрывает. Презентационная —
// состояние решает App через lib/quickAdd.js (fabState): 'on' — приподнятый круг
// акцента, 'sunk' — круг утоплен в меню (открыт композер/экспорт), неактивен.
// Кнопка есть всегда — пустого места по центру меню больше не бывает (v6.0.4).
// На десктопе скрыта в CSS: там в хабе «Тренировки» есть явная кнопка.
//
// Иконка — инлайн-SVG (как TabIcon/SyncIcon, без зависимостей), красится через
// currentColor; круг, цвет и анимация утапливания — в CSS (.tab-add / .tab-add-circle).
export default function AddFab({ onClick, sunk = false }) {
  return (
    <button
      className={'tab-add' + (sunk ? ' tab-add--sunk' : '')}
      onClick={onClick}
      disabled={sunk}
      aria-label="Записать тренировку"
      title="Записать тренировку"
    >
      <span className="tab-add-circle">
        <svg
          className="fab-ico" viewBox="0 0 24 24" width="28" height="28"
          fill="none" stroke="currentColor" strokeWidth="2.6"
          strokeLinecap="round" aria-hidden="true"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </span>
    </button>
  )
}
