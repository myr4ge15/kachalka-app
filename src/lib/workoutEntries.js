// ============================================================================
// Чистые редьюсеры СОСТАВА тренировки — трансформации массива `entries`
// (форма композера: [{ exercise, sets:[{weight,reps,_k}], prog? }]). Вынесено из
// WorkoutScreen (был 651 строкой) как страховочная сетка ПЕРЕД разбивкой экрана:
// именно эти мутации состава — главный риск при рефакторе рендера, а без Dexie/
// React/сети их можно детерминированно покрыть node-тестами (workoutEntries.test).
//
// Все функции ЧИСТЫЕ и иммутабельные: принимают текущий `entries`, возвращают
// НОВЫЙ массив (или тот же по ссылке, если менять нечего — как и было в экране,
// чтобы setEntries не дёргал ре-рендер вхолостую). Побочки (тосты/валидация/сеть)
// остаются в WorkoutScreen. `sk()` — модульный счётчик стабильных ключей строк
// подхода (общий с progressionCard), поэтому новые подходы получают уникальный _k.
// ============================================================================
import { exerciseMetric, isCountMetric } from './metric.js'
import { WEIGHT_MAX, repsMax } from './setLimits.js'
import { defaultSet, sk } from './progressionCard.js'

// Добавить упражнение в конец (анти-дубль по exercise.id). Уже есть → массив без
// изменений (по ссылке). progMeta — панель автопрогрессии (или null).
export function appendExerciseIn(entries, ex, sets, progMeta = null) {
  if (entries.some((e) => e.exercise.id === ex.id)) return entries
  return [...entries, { exercise: ex, sets, prog: progMeta }]
}

// Убрать упражнение по индексу.
export function removeExerciseIn(entries, idx) {
  return entries.filter((_, i) => i !== idx)
}

// Вернуть ранее убранное упражнение на прежнее место (undo). Анти-дубль: если его
// успели вернуть/добавить — массив без изменений.
export function insertExerciseIn(entries, idx, entry) {
  if (entries.some((e) => e.exercise.id === entry.exercise.id)) return entries
  const next = entries.slice()
  next.splice(Math.min(idx, next.length), 0, entry)
  return next
}

// Замена упражнения в записи: подходы сохраняем (не вводить заново). Для не-весового
// нового упражнения обнуляем weight — инвариант «вес=0 у не-весовых». Валидацию
// (тот же id / дубль) держит вызывающий; здесь — только трансформация.
export function replaceExerciseIn(entries, idx, ex) {
  const count = isCountMetric(exerciseMetric(ex))
  return entries.map((e, i) => {
    if (i !== idx) return e
    const sets = count ? e.sets.map((s) => ({ ...s, weight: 0 })) : e.sets
    return { exercise: ex, sets }
  })
}

// Правка поля подхода (свободный ввод из инпута — значение как есть, строкой).
export function updateSetIn(entries, ei, si, field, value) {
  return entries.map((e, i) => {
    if (i !== ei) return e
    const sets = e.sets.map((s, j) => (j === si ? { ...s, [field]: value } : s))
    return { ...e, sets }
  })
}

// Степпер +/− с клампом по границам метрики (те же, что клампит сохранение):
// вес → [0, WEIGHT_MAX], повторы/секунды → [1, repsMax(metric)]. Нечисловое
// текущее значение ('', '.', '1.2.3' → NaN) стартует от минимума, а не «NaN».
export function stepSetIn(entries, ei, si, field, delta) {
  const min = field === 'reps' ? 1 : 0
  return entries.map((e, i) => {
    if (i !== ei) return e
    const max = field === 'weight' ? WEIGHT_MAX : repsMax(exerciseMetric(e.exercise))
    const base = Number(e.sets[si]?.[field])
    const cur = Number.isFinite(base) ? base : min
    const next = Math.min(max, Math.max(min, Math.round((cur + delta) * 100) / 100))
    const sets = e.sets.map((s, j) => (j === si ? { ...s, [field]: next } : s))
    return { ...e, sets }
  })
}

// Добавить подход = копия последнего (или дефолт метрики), со свежим ключом _k.
export function addSetIn(entries, ei) {
  return entries.map((e, i) => {
    if (i !== ei) return e
    const last = e.sets[e.sets.length - 1] ?? defaultSet(e.exercise)
    return { ...e, sets: [...e.sets, { ...last, _k: sk() }] }
  })
}

// Убрать подход по индексу.
export function removeSetIn(entries, ei, si) {
  return entries.map((e, i) =>
    i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e
  )
}

// Вернуть ранее убранный подход на прежнее место (undo). Упражнение ищем по id
// (индекс мог сдвинуться), подход вставляем на прежнюю позицию.
export function insertSetIn(entries, exId, si, set) {
  return entries.map((e) => {
    if (e.exercise.id !== exId) return e
    const sets = e.sets.slice()
    sets.splice(Math.min(si, sets.length), 0, set)
    return { ...e, sets }
  })
}

// Откат к чистой копии прошлой сессии («вернуть как в прошлый раз»): подходы =
// prog.prev со свежими ключами, панель помечается applied:false.
export function revertProgIn(entries, ei) {
  return entries.map((e, i) => {
    if (i !== ei || !e.prog) return e
    return {
      ...e,
      sets: e.prog.prev.map((s) => ({ ...s, _k: sk() })),
      prog: { ...e.prog, applied: false },
    }
  })
}

// Накатить рекомендацию («Применить»): подходы = prog.recSets со свежими ключами,
// панель помечается applied:true.
export function applyProgIn(entries, ei) {
  return entries.map((e, i) => {
    if (i !== ei || !e.prog) return e
    return {
      ...e,
      sets: e.prog.recSets.map((s) => ({ ...s, _k: sk() })),
      prog: { ...e.prog, applied: true },
    }
  })
}

// Показать/спрятать настройки прогрессии (шестерёнка) в карточке.
export function toggleProgSettingsIn(entries, ei) {
  return entries.map((e, i) =>
    i === ei && e.prog ? { ...e, prog: { ...e.prog, settingsOpen: !e.prog.settingsOpen } } : e
  )
}

// Подходы из целевого плана упражнения шаблона: `sets` подходов по `reps` повторов
// (× weight у весовых). Нет плана (легаси-шаблон) → один дефолтный подход.
export function setsFromTemplate(ex, item) {
  const n = Math.max(1, Math.round(Number(item?.sets)) || 0)
  if (!item?.sets) return [defaultSet(ex)]
  const count = isCountMetric(exerciseMetric(ex))
  const reps = Math.max(1, Math.round(Number(item.reps)) || defaultSet(ex).reps)
  const weight = count ? 0 : (Number(item.weight) || 0)
  return Array.from({ length: n }, () => ({ weight, reps, _k: sk() }))
}
