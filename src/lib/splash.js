// Сколько еще держать сплэш холодного старта (#splash из index.html), чтобы его
// анимация (сборка штанги, ~1,2 с) успела доиграть, а не мелькнула обрывком.
// Отсчет — от начала навигации (performance.now()), т.к. сплэш виден с момента
// парсинга HTML. При «уменьшить движение» анимации нет — убираем сразу.
export const SPLASH_MIN_MS = 1250
export const SPLASH_FADE_MS = 300
// Страховочный потолок: если «готово» так и не пришло (восстановление сессии
// повисло), сплэш все равно уходит — лучше экран входа, чем вечная заставка.
export const SPLASH_MAX_MS = 5000

export function splashDelay(elapsedMs, reducedMotion = false, minMs = SPLASH_MIN_MS) {
  if (reducedMotion) return 0
  const left = minMs - (Number.isFinite(elapsedMs) ? elapsedMs : 0)
  return Math.max(0, Math.round(left))
}

// Сигнал «приложение готово показать первый осмысленный экран». Сплэш снимается
// по нему, а не по таймеру с момента render(): восстановление сессии в App
// асинхронное (openUserDb + миграция), и пока оно идет, user === null и рисуется
// экран входа — снятый по таймеру сплэш показывал бы его мельком. Защелка: кто
// подписался после сигнала, получает его сразу.
let ready = false
const waiters = new Set()

export function markAppReady() {
  if (ready) return
  ready = true
  for (const fn of waiters) fn()
  waiters.clear()
}

export function onAppReady(fn) {
  if (ready) { fn(); return () => {} }
  waiters.add(fn)
  return () => waiters.delete(fn)
}

// Только для тестов.
export function resetAppReady() {
  ready = false
  waiters.clear()
}