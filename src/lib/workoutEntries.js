// ============================================================================
// Чистые редьюсеры СОСТАВА тренировки — трансформации массива `entries`
// (форма композера: [{ exercise, sets:[{weight,reps,_k}], prog? }]). Вынесено из
// WorkoutScreen (был 651 строкой) как страховочная сетка ПЕРЕД разбивкой экрана:
// именно эти мутации состава — главный риск при рефакторе рендера, а без Dexie/
// React/сети их можно детерминированно покрыть node-тестами (workoutEntries.test).
//
// Все функции ЧИСТЫЕ и иммутабельные: принимают текущий `entries`, возвращают
// НОВЫЙ массив (или тот же по ссылке, если менять нечего — как и было в экране,
// чтобы setEntries не дергал ре-рендер вхолостую). Побочки (тосты/валидация/сеть)
// остаются в WorkoutScreen. `sk()` — модульный счетчик стабильных ключей строк
// подхода (общий с progressionCard), поэтому новые подходы получают уникальный _k.
// ============================================================================
import { exerciseMetric, isCountMetric, hasExtraWeight, hasLoadWeight } from './metric.js'
import { WEIGHT_MAX, repsMax, weightMin, savableSet } from './setLimits.js'
import { templatePlan } from './templatePlan.js'
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
  const next = exerciseMetric(ex)
  const count = isCountMetric(next)
  return entries.map((e, i) => {
    if (i !== idx) return e
    // Килограммы ≠ километры (v6.12.0): при смене весового на дистанцию и обратно
    // поле weight тоже обнуляем, иначе «80 кг» становились «80 км».
    const prev = exerciseMetric(e.exercise)
    const unitChanged = prev !== next && (prev === 'distance' || next === 'distance')
    // Доп. вес «своего веса» переживает замену только на такое же упражнение
    // (брусья → подтягивания); 60 кг жима не должны стать «+60 кг» на брусьях.
    // Вес снаряда «На время» — так же: планка с блином → боковая планка.
    const keepExtra = (hasExtraWeight(next) && hasExtraWeight(prev)) || (hasLoadWeight(next) && hasLoadWeight(prev))
    const zero = count && !keepExtra
    const sets = zero || unitChanged ? e.sets.map((s) => ({ ...s, weight: zero ? 0 : '' })) : e.sets
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
// вес → [weightMin(metric), WEIGHT_MAX] (у «своего веса» «−» уходит ниже нуля —
// в помощь гравитрона/резины, v7.2.0), повторы/секунды → [1, repsMax(metric)].
// Нечисловое текущее значение ('', '.', '1.2.3' → NaN) стартует от 0 у веса и от 1
// у повторов, а не «NaN» и не от −200 кг помощи.
export function stepSetIn(entries, ei, si, field, delta) {
  return entries.map((e, i) => {
    if (i !== ei) return e
    const metric = exerciseMetric(e.exercise)
    const min = field === 'reps' ? 1 : weightMin(metric)
    const max = field === 'weight' ? WEIGHT_MAX : repsMax(metric)
    const base = Number(e.sets[si]?.[field])
    const cur = Number.isFinite(base) ? base : field === 'reps' ? 1 : 0
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

// Голосовой подход (v8.7.0): записать {weight, reps} в строку si (ключ _k строки
// сохраняется) или, если si за концом списка, добавить новой строкой.
export function putSetIn(entries, ei, si, set) {
  return entries.map((e, i) => {
    if (i !== ei) return e
    const value = { weight: set.weight, reps: set.reps }
    const sets = si < e.sets.length
      ? e.sets.map((s, j) => (j === si ? { ...s, ...value } : s))
      : [...e.sets, { ...value, _k: sk() }]
    return { ...e, sets }
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
      sets: (e.prog.restoreSets ?? e.prog.prev).map((s) => ({ ...s, _k: sk() })),
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
      prog: { ...e.prog, applied: true, restoreSets: e.sets.map((s) => ({ ...s })) },
    }
  })
}

// Показать/спрятать настройки прогрессии (шестеренка) в карточке.
export function toggleProgSettingsIn(entries, ei) {
  return entries.map((e, i) =>
    i === ei && e.prog ? { ...e, prog: { ...e.prog, settingsOpen: !e.prog.settingsOpen } } : e
  )
}

// Подходы из целевого плана упражнения шаблона: `sets` подходов по `reps` повторов
// (× weight у весовых). Нет плана (легаси-шаблон) → один дефолтный подход.
export function setsFromTemplate(ex, item) {
  return templatePlan(ex, item).map((s) => ({ ...s, _k: sk() }))
}

// Сколько подходов реально уйдет в запись и сколько строк будет пропущено
// (пустые/нулевые повторы, нечисловой вес). Считает тем же правилом, что и запись
// (setLimits.savableSet), поэтому число на кнопке «Сохранить» равно записанному.
export function countSavable(entries) {
  let sets = 0
  let skipped = 0
  for (const e of entries ?? []) {
    const metric = exerciseMetric(e?.exercise)
    for (const s of e?.sets ?? []) {
      if (savableSet(s, metric)) sets++
      else skipped++
    }
  }
  return { sets, skipped }
}
