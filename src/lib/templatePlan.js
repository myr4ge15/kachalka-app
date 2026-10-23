// Детальный план хранится отдельно от старых скалярных целей.
// Порядок массива — порядок подходов; metric — снимок единиц измерения.
import { exerciseMetric, isCountMetric, normMetric } from './metric.js'
import { savableSet } from './setLimits.js'

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

export function cleanTemplatePlan(plan, metric) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 1000) {
    throw new Error('В упражнении должно быть от 1 до 1000 подходов.')
  }
  return plan.map((s) => {
    const clean = savableSet(s, metric)
    if (!clean) throw new Error('Заполни вес и повторы или время каждого подхода.')
    // Вес снаряда «На время» (изометрия, 23.10.2026) в план шаблона пока не берем: upsert_template_v2 на сервере
    // отклоняет вес у time — шаблон ушел бы в dead-letter. Снимем вместе с SQL (задача в BACKLOG).
    return normMetric(metric) === 'time' ? { ...clean, weight: 0 } : clean
  })
}
