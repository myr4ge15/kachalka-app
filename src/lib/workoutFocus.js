import { exerciseMetric, fmtSet, leadingValue } from './metric.js'
import { pluralize } from './plural.js'

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

// Данные компактной карточки. «Заполнено» описывает форму, а не факт выполнения:
// явная отметка сделанного подхода появится только в Slice 2.
export function exerciseFocusSummary(entry) {
  const sets = entry?.sets ?? []
  const metric = exerciseMetric(entry?.exercise)
  const best = sets.reduce((found, set) => {
    const value = leadingValue(metric, [set])
    const foundValue = leadingValue(metric, found ? [found] : [])
    if (value !== foundValue) return value > foundValue ? set : found
    // При одинаковом весе информативнее подход с большим числом повторов.
    if (metric === 'weight' && Number(set?.reps) > Number(found?.reps)) return set
    return found
  }, null)
  const setLabel = pluralize(sets.length, 'подход', 'подхода', 'подходов')
  const complete = !isExerciseIncomplete(entry)

  return {
    complete,
    setCount: sets.length,
    best: best && leadingValue(metric, [best]) > 0 ? fmtSet(metric, best) : null,
    text: complete && best
      ? `${setLabel} · лучший ${fmtSet(metric, best)}`
      : `${setLabel} · нужно заполнить`,
  }
}
