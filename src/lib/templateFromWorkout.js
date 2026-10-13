// Точный снимок всех подходов завершённой тренировки, без UI-ключей.
import { exerciseMetric } from './metric.js'
import { cleanTemplatePlan } from './templatePlan.js'

export function templateExercisesFromWorkout(entries) {
  return (entries ?? []).flatMap((e) => {
    const exercise = e.exercise ?? (e.exercise_id ? { id: e.exercise_id } : null)
    if (!exercise?.id || !e.sets?.length) return []
    const metric = exerciseMetric(exercise)
    return [{ exercise, metric, set_plan: cleanTemplatePlan(e.sets, metric) }]
  })
}

// Имя шаблона по умолчанию: «Тренировка ДД.ММ» от даты тренировки (или сегодня).
export function defaultTemplateName(dateIso) {
  const d = dateIso ? new Date(dateIso) : new Date()
  const valid = !Number.isNaN(d.getTime())
  const s = (valid ? d : new Date()).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  return `Тренировка ${s}`
}
