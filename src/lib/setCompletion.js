// ============================================================================
// Отметки «подход выполнен» (PLAN-workout-focus, Slice 2) — чистая логика.
//
// Инвариант плана: готовность НЕ создаёт нового формата данных. Это транзиентное
// UI-состояние до сохранения: множество ключей отмеченных подходов, которое живёт
// в экране/хуке, а в документ тренировки и Dexie не попадает (см. cleanEntries в
// db/repo.js — оно пересобирает подходы в чистые {weight,reps}).
//
// Ключ подхода строим из стабильного exercise.id и ключа строки `_k` (модульный
// счётчик sk() из progressionCard.js). Благодаря этому:
//   • удаление подхода/упражнения само гасит его отметку (ключа больше нет в составе);
//   • undo возвращает тот же `_k` — отметка возвращается вместе с подходом;
//   • «Применить рекомендацию»/«вернуть как в прошлый раз» выдают свежие `_k`, то есть
//     подменённые значения честно считаются невыполненными.
// Фолбэк на индекс нужен только для подходов без `_k` (документ из Dexie до toEntries).
// ============================================================================

export function setDoneKey(exerciseId, set, si) {
  return `${exerciseId ?? '?'}::${set?._k ?? `i${si}`}`
}

// Все ключи состава — засев «всё выполнено» при правке уже сохранённой тренировки
// (записанная тренировка по определению выполнена).
export function allSetKeys(entries) {
  const keys = []
  for (const entry of entries ?? []) {
    const exId = entry?.exercise?.id
    ;(entry?.sets ?? []).forEach((set, si) => keys.push(setDoneKey(exId, set, si)))
  }
  return keys
}

export function isSetDone(doneKeys, exerciseId, set, si) {
  return !!doneKeys?.has(setDoneKey(exerciseId, set, si))
}

// Иммутабельное переключение (отмена доступна тем же тапом и НЕ трогает значения).
export function toggleDoneKey(doneKeys, key) {
  const next = new Set(doneKeys ?? [])
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

// Прогресс упражнения: считаем только подходы, которые есть в составе СЕЙЧАС —
// устаревшие ключи удалённых подходов на счётчик не влияют.
export function exerciseCompletion(entry, doneKeys) {
  const sets = entry?.sets ?? []
  const exId = entry?.exercise?.id
  const doneCount = sets.reduce(
    (n, set, si) => n + (isSetDone(doneKeys, exId, set, si) ? 1 : 0),
    0
  )
  return {
    setCount: sets.length,
    doneCount,
    allDone: sets.length > 0 && doneCount === sets.length,
  }
}
