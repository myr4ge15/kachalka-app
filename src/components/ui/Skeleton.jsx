// Примитив-заглушка контента: серая плашка формы будущего элемента вместо строки
// «Загрузка…» / пустого экрана (слой примитивов UX-полировки «нативности»,
// ощущение «мгновенности»). Класс/shimmer/reduced-motion — в .skel (src/index.css).
//
// Использование: собрать каркас из плашек в геометрии реального контента, напр.
//   <Skeleton h={64} r={12} />                  — карточка
//   <Skeleton w="60%" h={14} />                 — строка текста
// w/h/r принимают число (→ px) или строку (любая CSS-единица: '60%', '3rem').
// aria-hidden — заглушки не озвучиваются скринридером (это не контент).
export default function Skeleton({ w, h, r, className = '', style }) {
  const s = { ...style }
  if (w != null) s.width = typeof w === 'number' ? `${w}px` : w
  if (h != null) s.height = typeof h === 'number' ? `${h}px` : h
  if (r != null) s.borderRadius = typeof r === 'number' ? `${r}px` : r
  return (
    <span
      className={'skel' + (className ? ' ' + className : '')}
      style={s}
      aria-hidden="true"
    />
  )
}
