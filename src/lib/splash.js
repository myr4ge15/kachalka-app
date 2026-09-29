// Сколько ещё держать сплэш холодного старта (#splash из index.html), чтобы его
// анимация (сборка штанги, ~1,2 с) успела доиграть, а не мелькнула обрывком.
// Отсчёт — от начала навигации (performance.now()), т.к. сплэш виден с момента
// парсинга HTML. При «уменьшить движение» анимации нет — убираем сразу.
export const SPLASH_MIN_MS = 1250
export const SPLASH_FADE_MS = 300

export function splashDelay(elapsedMs, reducedMotion = false, minMs = SPLASH_MIN_MS) {
  if (reducedMotion) return 0
  const left = minMs - (Number.isFinite(elapsedMs) ? elapsedMs : 0)
  return Math.max(0, Math.round(left))
}
