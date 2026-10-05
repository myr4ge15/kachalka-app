// Закрытие просмотра картинки свайпом (v6.12.1): вверх или вниз — как в галерее
// телефона. Чистые функции без DOM — покрыты swipeDismiss.test.js.

export const DISMISS_DISTANCE = 90 // px — достаточно протянуть
export const FLICK_DISTANCE = 40   // px — короткий, но быстрый взмах
export const FLICK_SPEED = 0.5     // px/мс

// Закрывать ли по итогам жеста: dy — смещение по вертикали, dx — по горизонтали,
// dt — длительность в мс. Горизонтальный жест (листание, свайп «назад») — не наш.
export function shouldDismiss({ dx = 0, dy, dt }) {
  const ay = Math.abs(dy)
  if (ay < Math.abs(dx)) return false
  if (ay >= DISMISS_DISTANCE) return true
  return ay >= FLICK_DISTANCE && dt > 0 && ay / dt >= FLICK_SPEED
}

// Насколько прозрачна картинка, пока ее тянут: 1 → 0.4 к 2×DISMISS_DISTANCE.
export function dragOpacity(dy) {
  const k = Math.min(1, Math.abs(dy) / (DISMISS_DISTANCE * 2))
  return Math.round((1 - 0.6 * k) * 100) / 100
}
