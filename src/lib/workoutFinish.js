import { totalTonnage } from './profileStats.js'

function explicitDurationSeconds(workout) {
  const raw = workout?.duration_seconds ?? workout?.durationSeconds
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null
}

// Локальный документ тренировки → спокойная сводка для экрана завершения.
// Учитываем только реально сохранённые подходы. Длительность не выводим из
// created_at/updated_at: это часы документа, а не время самой тренировки.
export function workoutFinishSummary(workout) {
  const entries = (workout?.entries ?? []).filter((entry) => (entry.sets?.length ?? 0) > 0)
  return {
    exerciseCount: entries.length,
    setCount: entries.reduce((sum, entry) => sum + entry.sets.length, 0),
    tonnage: totalTonnage([{ entries }]),
    durationSeconds: explicitDurationSeconds(workout),
  }
}

export function formatWorkoutDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return null
  const minutes = Math.max(1, Math.round(value / 60))
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}
