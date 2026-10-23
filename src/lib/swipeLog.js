// Журнал свайпов «назад» этого устройства (23.10.2026, fb_e1583b4f / fb_d5c13f18: «свайп прыгает», по видео не
// понять, почему жест не доходит). Последние SWIPE_LOG_MAX жестов: исход, сдвиг в % ширины, скорость (средняя и
// пик броска, px/мс), сколько было точек и почему вернулся. Только localStorage — на сервер не уходит; смотреть —
// Админка → «Журнал свайпов (это устройство)». Ошибки хранилища молчат: журнал — отладка, не данные.
export const SWIPE_LOG_KEY = 'gym_app_swipe_log'
export const SWIPE_LOG_MAX = 30

export function logSwipe(entry, storage = globalThis.localStorage) {
  try {
    const list = readSwipeLog(storage)
    list.unshift({ at: new Date().toISOString(), ...entry })
    storage.setItem(SWIPE_LOG_KEY, JSON.stringify(list.slice(0, SWIPE_LOG_MAX)))
  } catch { /* приватный режим, переполнение — без журнала */ }
}

export function readSwipeLog(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(SWIPE_LOG_KEY) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

export function clearSwipeLog(storage = globalThis.localStorage) {
  try { storage.removeItem(SWIPE_LOG_KEY) } catch { /* нечего чистить */ }
}

// Строка для экрана: «23.10 13:40 · назад · 42% · 0,61 / 1,20 px/мс · 9 точек».
const OUTCOME = { commit: 'назад', back: 'вернулся', cancel: 'прерван' }
export function swipeLogLine(e) {
  const d = new Date(e.at)
  const time = Number.isNaN(d.getTime()) ? '—'
    : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const num = (v) => String(Math.round((Number(v) || 0) * 100) / 100).replace('.', ',')
  return [time, OUTCOME[e.kind] ?? e.kind, `${Math.round((Number(e.p) || 0) * 100)}%`,
    `${num(e.v)} / ${num(e.flick)} px/мс`, `${e.moves ?? 0} точек`,
    e.ms != null ? `${e.ms} мс` : null, e.lag > 0 ? `отрыв +${e.lag} мс` : null, e.why || null].filter(Boolean).join(' · ')
}
