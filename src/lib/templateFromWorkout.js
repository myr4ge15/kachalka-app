// ============================================================================
// Чистая логика «Шаблон из тренировки» — без React/Dexie/DOM, тестируется в node.
//
// Превращает состав тренировки (денормализованные entries) в список упражнений
// ШАБЛОНА с целевым планом (подходы × повторы × вес). Форма результата совпадает с
// той, что ждёт repo.saveTemplate → cleanTemplateExercises/cleanTargets:
//   { exercise, sets, reps, weight }
// где sets — число подходов, reps — целевые повторы (у time — секунды), weight —
// целевой вес (0 у не-весовых).
// ============================================================================
import { exerciseMetric } from './metric.js'

// «Целевой» подход упражнения = лучший рабочий подход: по весу (весовые) или по
// повторам/секундам (без веса). Он и задаёт план reps × weight будущего шаблона,
// а число подходов = сколько их было в тренировке.
export function templateExercisesFromWorkout(entries) {
  return (entries ?? [])
    .map((e) => {
      const ex = e.exercise ?? (e.exercise_id ? { id: e.exercise_id } : null)
      const sets = (e.sets ?? []).filter(Boolean)
      if (!ex?.id || sets.length === 0) return null
      const weighted = exerciseMetric(ex) === 'weight'
      // Лучший подход по ведущей метрике.
      let top = sets[0]
      let topLead = -Infinity
      for (const s of sets) {
        const lead = weighted ? Number(s.weight) || 0 : Number(s.reps) || 0
        if (lead > topLead) { topLead = lead; top = s }
      }
      return {
        exercise: ex,
        sets: sets.length,
        reps: Math.max(1, Math.round(Number(top.reps) || 0)),
        weight: weighted ? Math.max(0, Number(top.weight) || 0) : 0,
      }
    })
    .filter(Boolean)
}

// Имя шаблона по умолчанию: «Тренировка ДД.ММ» от даты тренировки (или сегодня).
export function defaultTemplateName(dateIso) {
  const d = dateIso ? new Date(dateIso) : new Date()
  const valid = !Number.isNaN(d.getTime())
  const s = (valid ? d : new Date()).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  return `Тренировка ${s}`
}
