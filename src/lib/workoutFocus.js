import { exerciseMetric } from './metric.js'

function blankOrNonPositive(value) {
  if (value === '' || value == null) return true
  const n = Number(value)
  return !Number.isFinite(n) || n <= 0
}

// «Незаполненное» упражнение для стартового фокуса при редактировании:
// нет подходов, нет ведущего значения или у весовой метрики не указан вес.
// Для reps/time weight=0 — штатный формат, поэтому проверяем только reps.
export function isExerciseIncomplete(entry) {
  if (!entry?.sets?.length) return true
  const weighted = exerciseMetric(entry.exercise) === 'weight'
  return entry.sets.some((set) => (
    blankOrNonPositive(set?.reps) ||
    (weighted && blankOrNonPositive(set?.weight))
  ))
}

// Стабильный id важнее индекса: состав можно удалять, заменять и дополнять
// шаблоном, не переводя фокус на случайную соседнюю карточку.
export function pickActiveExerciseId(entries, currentId, { preferIncomplete = false } = {}) {
  const list = entries ?? []
  if (currentId && list.some((entry) => entry?.exercise?.id === currentId)) return currentId

  const preferred = preferIncomplete
    ? list.find((entry) => isExerciseIncomplete(entry))
    : null
  return preferred?.exercise?.id ?? list[0]?.exercise?.id ?? null
}
