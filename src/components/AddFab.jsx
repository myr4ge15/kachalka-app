// Кнопка «+» — запись тренировки в один тап. С редизайна «Спорт-блоки» (v6, этап 2)
// это круглая кнопка ПО ЦЕНТРУ нижнего меню (между «Тренировками» и «Лентой»), а не
// плавающая над контентом: внутри меню она ничего не перекрывает. Презентационная —
// решение «показывать или нет» принимает App через lib/quickAdd.js (canShowFab),
// сюда приходит готовый onClick. На десктопе скрыта в CSS: там в хабе «Тренировки»
// есть явная кнопка «+ Добавить тренировку».
//
// Иконка — инлайн-SVG (как TabIcon/SyncIcon, без зависимостей), красится через
// currentColor; круг и цвет — в CSS (.tab-add / .tab-add-circle).
export default function AddFab({ onClick }) {
  return (
    <button className="tab-add" onClick={onClick} aria-label="Записать тренировку" title="Записать тренировку">
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
