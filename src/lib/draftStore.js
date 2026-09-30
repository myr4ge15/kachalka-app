// Хранилище черновика новой тренировки (состав, отметки выполнения, оценки RPE).
//
// Раньше черновик жил в Map в памяти (lib/cache.js) и умирал вместе со страницей:
// телефон выгрузил PWA в фоне между подходами, нажали «Обновить» на плашке новой
// версии, случайный reload — и занятие приходилось вбивать заново. Теперь:
//   - память — авторитетный слой в пределах жизни страницы (последнее значение,
//     даже если запись на диск не удалась);
//   - localStorage — переживает перезапуск; с него черновик поднимается на
//     холодном старте. Синхронное чтение важно: экран берет черновик прямо в
//     инициализаторе useState, без мигания пустым составом.
// Черновик — незавершенное действие на ОДНОМ устройстве, поэтому в синк он не
// идет (как merge_conflicts). Ключ включает userId — учетки общего телефона не
// видят черновики друг друга.
const PREFIX = 'gym_app_'
const memory = new Map()

function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // приватный режим / запрет хранилища — работаем только из памяти
  }
}

// Пустой состав/отметки/оценки на диске не держим — это «черновика нет».
function isEmpty(value) {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

export function readDraft(key) {
  if (memory.has(key)) return memory.get(key)
  const s = storage()
  if (!s) return undefined
  try {
    const raw = s.getItem(PREFIX + key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined // битое значение не должно ронять экран
  }
}

export function writeDraft(key, value) {
  memory.set(key, value)
  const s = storage()
  if (!s) return
  try {
    if (isEmpty(value)) s.removeItem(PREFIX + key)
    else s.setItem(PREFIX + key, JSON.stringify(value))
  } catch { /* квота/запрет — последнее значение остается в памяти */ }
}

export function clearDraft(key) {
  memory.delete(key)
  try {
    storage()?.removeItem(PREFIX + key)
  } catch { /* нечего чистить */ }
}

// Только для тестов: сбросить слой памяти (localStorage тест чистит сам).
export function resetDraftMemory() {
  memory.clear()
}
