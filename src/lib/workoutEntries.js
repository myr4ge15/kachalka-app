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
import { steppedSetValue, savableSet, needsSetWeight } from './setLimits.js'
import { loadUnit, loadValue, loadLimit, withLoad } from './setLoad.js'
import { templateInputPlan } from './templatePlan.js'
import { defaultSet, sessionsForMetric, sk } from './progressionCard.js'
import { orderByPhase, phaseValue } from './workoutPhases.js'

// Добавить упражнение в конец основной части (анти-дубль по exercise.id). Уже есть → массив без
// изменений (по ссылке). progMeta — панель автопрогрессии (или null).
export function appendExerciseIn(entries, ex, sets, progMeta = null) {
  if (entries.some((e) => e.exercise.id === ex.id)) return entries
  return orderByPhase([...entries, { exercise: ex, sets, prog: progMeta }])
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
  return orderByPhase(next)
}

// Общая замена для записи и шаблона. Килограммы и километры не переносятся
// между метриками. Доп. вес и вес снаряда сохраняются внутри своей метрики.
export function setsForExerciseReplacement(sets, prev, next) {
  const unitChanged = prev !== next && (prev === 'distance' || next === 'distance')
  const keepExtra = (hasExtraWeight(next) && hasExtraWeight(prev)) || (hasLoadWeight(next) && hasLoadWeight(prev))
  const zero = isCountMetric(next) && !keepExtra
  return sets.map(s => {
    if (s.load_input) return withLoad(s, 'kg', zero ? 0 : '')
    return zero || unitChanged ? { ...s, weight: zero ? 0 : '' } : s
  })
}

// Валидацию (тот же id / дубль) держит вызывающий.
export function replaceExerciseIn(entries, idx, ex) {
  const next = exerciseMetric(ex)
  return entries.map((e, i) => i === idx
    ? { ...(phaseValue(e.phase) ? { phase: e.phase } : {}), exercise: ex, sets: setsForExerciseReplacement(e.sets, exerciseMetric(e.exercise), next)
      .map(s => { const copy = { ...s }; delete copy.targetLabel; return copy }) }
    : e)
}

// Правка поля подхода (свободный ввод из инпута — значение как есть, строкой).
export function updateSetIn(entries, ei, si, field, value) {
  return entries.map((e, i) => {
    if (i !== ei) return e
    const sets = e.sets.map((s, j) => {
      if (j !== si) return s
      return field === 'weight' ? withLoad(s, loadUnit(s), value) : { ...s, [field]: value }
    })
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
    const row = e.sets[si]
    if (field === 'weight' && row?.load_input) {
      const unit = loadUnit(row)
      const value = Math.min(loadLimit(unit), Math.max(unit === 'block' ? 1 : 0, (Number(loadValue(row)) || 0) + Math.sign(delta)))
      return { ...e, sets: e.sets.map((s, j) => j === si ? withLoad(s, unit, value) : s) }
    }
    const next = steppedSetValue(e.sets[si]?.[field], metric, field, delta)
    const sets = e.sets.map((s, j) => (j === si ? { ...s, [field]: next } : s))
    return { ...e, sets }
  })
}

// Добавить подход = копия последнего (или дефолт метрики), со свежим ключом _k.
export function addSetIn(entries, ei) {
  return entries.map((e, i) => {
    if (i !== ei) return e
    const last = e.sets.at(-1) ?? defaultSet(e.exercise)
    if (!e.sets.length && e.inputUnit) return { ...e, sets: [withLoad(last, e.inputUnit, '')] }
    return { ...e, sets: [...e.sets, { weight: last.weight, reps: last.reps, ...(last.load_input && { load_input: last.load_input }), _k: sk() }] }
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

// Отмена рекомендации восстанавливает подходы до ее применения. Если она
// подставилась автоматически, возвращаем прошлую сессию.
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
// Вес берем из соответствующей строки последней совместимой сессии.
// Дистанция и строки без веса в истории сохраняют значения плана.
export function setsFromTemplate(ex, item, sessions) {
  const metric = exerciseMetric(ex)
  const previous = metric === 'distance' ? undefined : sessionsForMetric(sessions, metric)[0]?.sets
  return templateInputPlan(ex, item).map((set, index) => {
    const prior = previous?.[index] ?? (previous?.[0]?.load_input && previous.at(-1))
    if (!prior || !Number.isFinite(prior.weight)) return { ...set, _k: sk() }
    return { ...withLoad(set, loadUnit(prior), loadValue(prior)), _k: sk() }
  })
}

// Сколько подходов реально уйдет в запись и сколько строк будет пропущено
// (пустые/нулевые повторы, нечисловой вес). Считает тем же правилом, что и запись
// (setLimits.savableSet), поэтому число на кнопке «Сохранить» равно записанному.
export function countSavable(entries) {
  let sets = 0
  let skipped = 0
  let missingWeights = 0
  for (const e of entries ?? []) {
    const metric = exerciseMetric(e?.exercise)
    for (const s of e?.sets ?? []) {
      if (savableSet(s, metric)) sets++
      else {
        skipped++
        if (needsSetWeight(s, metric) && Number(s?.reps) > 0) missingWeights++
      }
    }
  }
  return { sets, skipped, missingWeights }
}
