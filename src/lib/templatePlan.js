// Детальный план хранится отдельно от старых скалярных целей.
// Порядок массива — порядок подходов; metric — снимок единиц измерения.
import { exerciseMetric, isCountMetric } from './metric.js'
import { needsSetWeight, savableSet } from './setLimits.js'

export function templatePlan(exercise, item) {
  if (Array.isArray(item?.set_plan)) return item.set_plan.map((s) => ({ ...s }))
  const metric = exerciseMetric(exercise)
  const reps = metric === 'time' ? 60 : metric === 'distance' ? 1800 : 10
  const n = item?.sets ? Math.max(1, Math.round(Number(item.sets)) || 1) : 1
  const weight = item?.sets ? (isCountMetric(metric) ? 0 : Number(item.weight) || 0) : metric === 'weight' ? 20 : 0
  return Array.from({ length: Math.min(n, 1000) }, () => ({
    weight, reps: Math.max(1, Math.round(Number(item?.reps)) || reps),
  }))
}

export function templateInputPlan(exercise, item) {
  return templatePlan(exercise, item).map(({ weight_unset, weight, ...set }) => ({
    ...set, weight: weight_unset && exerciseMetric(exercise) === 'weight' ? '' : weight,
  }))
}

export function cleanTemplatePlan(plan, metric) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 1000) {
    throw new Error('В упражнении должно быть от 1 до 1000 подходов.')
  }
  return plan.map((s) => {
    const unset = needsSetWeight(s, metric) || (metric === 'weight' && s?.weight_unset === true && s.weight === 0)
    const clean = savableSet(unset ? { ...s, weight: 0 } : s, metric)
    if (!clean) throw new Error('Заполни вес и повторы или время каждого подхода.')
    // Вес снаряда «На время» (изометрия) сервер принимает с migrations/20261023140000_workout_phases.sql.
    return unset ? { ...clean, weight_unset: true } : clean
  })
}
