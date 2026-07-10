// Тактильный отклик (вибро) в ключевых точках — слой примитивов UX-полировки
// «нативности» («каждое действие даёт физический отклик»). На Android-PWA
// navigator.vibrate работает бесплатно и заметно добавляет «нативности»; на iOS
// не поддержан — тихий no-op, ничего не ломает. Потребители зовут vibrate(HAPTIC.*)
// в точках вроде сохранения тренировки, нового рекорда/цели, постановки реакции.
//
// Решение «вибрировать ли» вынесено в чистую shouldVibrate (без navigator/matchMedia)
// ради теста — по образцу realtimeSync.js / backoff.js.

// Именованные паттерны — единый словарь силы отклика, чтобы точки вызова не
// хардкодили числа. Число = мс; массив = чередование «вибро/пауза/вибро…».
export const HAPTIC = {
  tap: 10,               // лёгкое касание: реакция, степпер, переключатель
  success: 20,           // подтверждение: сохранение тренировки
  celebrate: [15, 40, 15], // праздник: новый рекорд / достигнутая цель
}

// Чистое решение: стоит ли вибрировать. Вибрируем только когда API есть И
// пользователь не просил «уменьшить движение» (тактильный шум — тоже движение).
export function shouldVibrate({ hasVibrate, reducedMotion }) {
  return !!hasVibrate && !reducedMotion
}

// Уважать системную настройку «уменьшить движение». Обёрнуто в try/catch: в
// нестандартных средах (SSR/тест без jsdom) matchMedia может отсутствовать.
function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Дать тактильный отклик указанным паттерном (по умолчанию — лёгкое касание).
// Возвращает true, если вибрация была запрошена у платформы; иначе false
// (нет API / reduced-motion / бросок) — вызов безопасен где угодно.
export function vibrate(pattern = HAPTIC.tap) {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const hasVibrate = !!(nav && typeof nav.vibrate === 'function')
  if (!shouldVibrate({ hasVibrate, reducedMotion: prefersReducedMotion() })) return false
  try {
    return nav.vibrate(pattern)
  } catch {
    return false
  }
}
