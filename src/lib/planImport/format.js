// Поля плана — цели. Диапазон [min, max] сохраняется вплоть до записи факта.
import { ASSIST_MAX, REPS_MAX, TIME_MAX, WEIGHT_MAX } from '../setLimits.js'

export const FORMAT = 'workout-plan/v1'
export const MAX_SETS = 1000
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const string = value => typeof value === 'string' && value.trim().length > 0

function positive(value, max, integer) {
  return Number.isFinite(value) && value > 0 && value <= max && (!integer || Number.isInteger(value))
}

export function target(value, max, integer = true) {
  if (!Array.isArray(value)) return positive(value, max, integer)
  return value.length === 2 && value.every(n => positive(n, max, integer)) && value[0] <= value[1]
}

export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const t = new Date(date)
  return Number.isFinite(+t) && t.toISOString().slice(0, 10) === date
}

function fields(obj, keys, path) {
  if (!record(obj)) throw Error(path + ' — ожидается объект')
  const unknown = Object.keys(obj).filter(key => !keys.includes(key))
  if (unknown.length) throw Error(path + ' — неизвестные поля: ' + unknown.join(', '))
}

export function checkSet(set, path) {
  // Указано только число подходов. Фактические цели ещё предстоит заполнить.
  if (record(set) && set.pending === true && Object.keys(set).length === 1) return
  fields(set, ['kg', 'reps', 'seconds', 'km', 'phase', 'optional'], path)
  if ('optional' in set && typeof set.optional !== 'boolean') throw Error(path + ' — optional должно быть логическим')
  const { kg, reps, seconds, km, phase } = set
  if (reps === undefined && seconds === undefined && km === undefined) throw Error(path + ' — нет цели')
  if (reps !== undefined && (!target(reps, REPS_MAX) || seconds !== undefined || km !== undefined)) throw Error(path + ' — проверь повторы и единицы')
  if (seconds !== undefined && !target(seconds, TIME_MAX)) throw Error(path + ' — проверь секунды')
  if (km !== undefined && (!target(km, Infinity, false) || kg !== undefined)) throw Error(path + ' — проверь километры')
  if (kg !== undefined) {
    const weights = Array.isArray(kg) ? kg : [kg]
    if ((Array.isArray(kg) && (kg.length !== 2 || kg[0] > kg[1])) ||
      weights.some(w => !Number.isFinite(w) || w < -ASSIST_MAX || w > WEIGHT_MAX)) throw Error(path + ' — проверь килограммы')
  }
  if (phase !== undefined && !['warmup', 'work', 'cooldown'].includes(phase)) throw Error(path + ' — неизвестная фаза')
}

export function checkPlan(plan) {
  fields(plan, ['format', 'date', 'name', 'notes', 'exercises'], 'План')
  if (plan.format !== FORMAT) throw Error('Ожидается формат ' + FORMAT)
  if (plan.date !== undefined && !validDate(plan.date)) throw Error('Дата должна быть в виде ГГГГ-ММ-ДД')
  if (!Array.isArray(plan.exercises) || !plan.exercises.length) throw Error('Нужен список упражнений')
  for (const key of ['name', 'notes']) if (key in plan && !string(plan[key])) throw Error('Проверь поле ' + key)
  let count = 0
  for (const [i, ex] of plan.exercises.entries()) {
    const path = 'exercises[' + i + ']'
    fields(ex, ['name', 'exercise_id', 'sets', 'rest_sec', 'notes'], path)
    if (!string(ex.name)) throw Error(path + ' — нужно название')
    for (const key of ['exercise_id', 'notes']) if (key in ex && !string(ex[key])) throw Error(path + '.' + key + ' — ожидается текст')
    if ('rest_sec' in ex && !target(ex.rest_sec, TIME_MAX)) throw Error(path + ' — проверь отдых')
    if (!Array.isArray(ex.sets) || !ex.sets.length) throw Error(path + ' — нужны подходы')
    count += ex.sets.length
    if (count > MAX_SETS) throw Error('Слишком много подходов для одной тренировки')
    ex.sets.forEach((set, j) => checkSet(set, path + '.sets[' + j + ']'))
  }
  return plan
}

// Планы из чата используют и имена полей журнала. Переводим их в тот же
// формат, который проверяют предпросмотр и CLI. Цели и единицы проверяет checkPlan.
function importedSet(set, phase) {
  fields(set, ['weight', 'reps', 'reps_max'], 'Подход')
  return { reps: 'reps_max' in set ? [set.reps, set.reps_max] : set.reps,
    ...('weight' in set && { kg: set.weight }), ...(phase && { phase }) }
}

function importedEntry(entry, nested) {
  fields(entry, nested ? ['exercise', 'sets', 'warmup_sets', 'rest_seconds', 'notes'] : ['name', 'sets'], 'Упражнение')
  const exercise = nested ? entry.exercise : entry
  if (nested) fields(exercise, ['id', 'name', 'metric', 'muscle_group'], 'Описание упражнения')
  if (!Array.isArray(entry.sets) || !entry.sets.length || ('warmup_sets' in entry && !Array.isArray(entry.warmup_sets))) {
    throw Error('Проверь список подходов упражнения')
  }
  const warmup = (entry.warmup_sets ?? []).map(set => importedSet(set, 'warmup'))
  return { name: exercise.name, ...('id' in exercise && { exercise_id: exercise.id }),
    sets: [...warmup, ...entry.sets.map(set => importedSet(set))],
    ...('rest_seconds' in entry && { rest_sec: entry.rest_seconds }), ...('notes' in entry && { notes: entry.notes }) }
}

function bounds(value, unit) {
  fields(value, ['min', 'max'], unit)
  if (![value.min, value.max].every(Number.isFinite) || value.min < 0 || value.min > value.max) throw Error('Проверь диапазон: ' + unit)
  return [value.min, value.max]
}

function cooldownEntry(cooldown) {
  fields(cooldown, ['name', 'duration_minutes', 'speed_kmh', 'incline_percent'], 'Заминка')
  const seconds = bounds(cooldown.duration_minutes, 'длительность заминки').map(n => n * 60)
  const notes = []
  if ('speed_kmh' in cooldown) notes.push('Скорость ' + bounds(cooldown.speed_kmh, 'скорость').join('–') + ' км/ч')
  if ('incline_percent' in cooldown) notes.push('Уклон ' + bounds(cooldown.incline_percent, 'уклон').join('–') + '%')
  return { name: cooldown.name, sets: [{ seconds, optional: true, phase: 'cooldown' }], ...(notes.length && { notes: notes.join('\n') }) }
}

export function readJsonPlan(raw) {
  if (!record(raw) || 'format' in raw || ('schema' in raw && raw.schema !== FORMAT)) return checkPlan(raw)
  const nested = raw.schema === FORMAT
  const keys = nested ? ['schema', 'status', 'entries', 'working_sets', 'warmup', 'optional_cooldown', 'duration_minutes'] : ['exercises']
  fields(raw, ['name', 'date', 'notes', ...keys], 'План')
  const entries = nested ? raw.entries : raw.exercises
  if (!Array.isArray(entries) || !entries.length) throw Error('Нужен список упражнений')
  if ('status' in raw && raw.status !== 'planned') throw Error('Можно вставить только запланированную тренировку')
  const exercises = entries.map(entry => importedEntry(entry, nested))
  if ('working_sets' in raw && raw.working_sets !== entries.reduce((count, entry) => count + entry.sets.length, 0)) {
    throw Error('Число рабочих подходов расходится со списком упражнений')
  }
  if ('warmup' in raw) {
    fields(raw.warmup, ['exercise', 'duration_seconds'], 'Разминка')
    const ex = raw.warmup.exercise
    fields(ex, ['id', 'name', 'metric', 'muscle_group'], 'Упражнение разминки')
    exercises.unshift({ name: ex.name, ...('id' in ex && { exercise_id: ex.id }), sets: [{ seconds: raw.warmup.duration_seconds, phase: 'warmup' }] })
  }
  if ('optional_cooldown' in raw) exercises.push(cooldownEntry(raw.optional_cooldown))
  const plan = { format: FORMAT, exercises }
  for (const key of ['name', 'date', 'notes']) if (key in raw) plan[key] = raw[key]
  checkPlan(plan)
  if ('duration_minutes' in raw) {
    const duration = bounds(raw.duration_minutes, 'длительность тренировки')
    plan.notes = ['Длительность ' + duration.join('–') + ' мин', plan.notes].filter(Boolean).join('\n')
  }
  return plan
}
