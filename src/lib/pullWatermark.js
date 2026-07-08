// Чистые хелперы инкрементального pull (без Dexie/сети). Задача: не тянуть всю
// базу каждые 20 c, а сверять серверный watermark (max updated_at) / сигнатуру
// ростера и качать только дельту. Логика вынесена сюда, чтобы покрыть тестами
// (по образцу pullReconcile.js / mergeClock.js). Потребитель — src/db/sync.js.
//
// updated_at — серверные ISO-строки timestamptz в одном формате, поэтому
// лексикографическое сравнение = хронологическому (как в lib/cmp.js). Пустые/
// отсутствующие значения трактуем как «нет данных» (null).
import { cmpIsoAsc } from './cmp.js'

// Максимальный updated_at по массиву строк (или null, если пусто/нет поля).
// Игнорирует строки без валидного updated_at.
export function maxUpdatedAt(rows, key = 'updated_at') {
  let max = null
  for (const r of rows ?? []) {
    const v = r?.[key]
    if (!v) continue
    if (max === null || cmpIsoAsc(v, max) > 0) max = v
  }
  return max
}

// Изменилось ли что-то на сервере с прошлого pull. serverMax — max updated_at по
// серверной пробе, watermark — сохранённое значение прошлого прогона.
//   watermark пуст (первый прогон)         → true  (качаем всё);
//   serverMax пуст (сервер пуст/без поля)  → false (нечего тянуть);
//   serverMax > watermark                  → true.
export function changedSince(serverMax, watermark) {
  if (!watermark) return true
  if (!serverMax) return false
  return cmpIsoAsc(serverMax, watermark) > 0
}

// Сигнатура ростера/окна для сущностей, где ВОЗМОЖНО удаление строки (users,
// шаблоны): одного max(updated_at) мало — пропажа строки его не двигает. Сигнатура
// = отсортированные id + max updated_at. Меняется и на правке (updated_at растёт),
// и на удалении/появлении (меняется набор id). Сравнение строк сигнатур в sync.js.
export function rosterSignature(rows, idKey = 'id', tsKey = 'updated_at') {
  const ids = (rows ?? [])
    .map((r) => String(r?.[idKey] ?? ''))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([ids, maxUpdatedAt(rows, tsKey) ?? ''])
}
