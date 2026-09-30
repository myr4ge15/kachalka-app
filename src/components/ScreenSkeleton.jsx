import Skeleton from './Skeleton.jsx'

// Каркас экрана для Suspense-фолбэка при переключении вкладок. Вместо строки
// «Загрузка…» на пустом экране — серые плашки в примерной геометрии контента
// (заголовок + список карточек). Дает «мгновенность»: переход не проваливается в
// пустоту, пока подтягивается ленивый чанк (особенно «Прогресс» с тяжелым recharts).
// Форма намеренно обобщенная (почти все экраны — список карточек), не имитируем
// каждый экран пиксель-в-пиксель. aria-busy — озвучивает загрузку скринридеру.
export default function ScreenSkeleton({ cards = 4 }) {
  return (
    <div className="screen" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="skel-title" w="46%" h={22} r={7} />
      <div className="skel-cards">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} h={72} r={14} />
        ))}
      </div>
    </div>
  )
}
