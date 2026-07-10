import Skeleton from './Skeleton.jsx'

// Каркас списка карточек для in-screen загрузки данных — заменяет строку
// «Загрузка…» там, где форма контента известна (история, прогресс, лента,
// лидерборд). Без обёртки `.screen`/заголовка: экран уже отрисовал свою шапку,
// скелетон встаёт на место будущего списка. aria-busy озвучивает загрузку.
export default function CardsSkeleton({ cards = 3, height = 72 }) {
  return (
    <div className="skel-cards" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} h={height} r={14} />
      ))}
    </div>
  )
}
