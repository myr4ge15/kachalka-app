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
