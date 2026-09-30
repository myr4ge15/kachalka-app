// Точка активной вкладки нижнего меню (редизайн «Спорт-блоки», этап 3, вариант A из
// prototypes/nav-animation.html): одна общая точка ПЕРЕЕЗЖАЕТ под нажатую вкладку,
// а не появляется на месте. Здесь — чистый расчёт позиции; измерение DOM и
// подписки — в hooks/useTabDot.js.

export const DOT_SIZE = 4

// Смещение точки от левого края меню: центр вкладки минус половина точки.
// Прямоугольники — как у getBoundingClientRect (нужны left и width).
export function dotX(navRect, tabRect, size = DOT_SIZE) {
  if (!navRect || !tabRect) return 0
  const x = (tabRect.left - navRect.left) + tabRect.width / 2 - size / 2
  return Number.isFinite(x) ? Math.round(x) : 0
}
