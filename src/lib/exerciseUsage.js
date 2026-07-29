import { entryExId, sortDesc } from './entries.js'

// Быстрые секции пикера упражнений из уже локальной истории:
// recent — уникальные упражнения последних тренировок в порядке использования;
// frequent — чаще всего встречавшиеся в тренировках (не дублируют recent).
// Считаем СЕССИИ, а не число подходов: 5 подходов в один день не делают
// упражнение «частее», чем одно упражнение в пяти разных тренировках.
export function exerciseUsageSections(workouts, { recentLimit = 4, frequentLimit = 4 } = {}) {
  const stats = new Map()
  const recent = []

  for (const [workoutIndex, workout] of sortDesc(workouts).entries()) {
    const seenInWorkout = new Set()
    for (const entry of workout.entries ?? []) {
      const id = entryExId(entry)
      if (!id || seenInWorkout.has(id)) continue
      seenInWorkout.add(id)

      if (!stats.has(id)) {
        stats.set(id, { id, sessions: 0, workoutIndex })
        recent.push(id)
      }
      stats.get(id).sessions++
    }
  }

  const recentIds = recent.slice(0, Math.max(0, recentLimit))
  const recentSet = new Set(recentIds)
  const frequentIds = [...stats.values()]
    .filter((x) => x.sessions >= 2 && !recentSet.has(x.id))
    .sort((a, b) => b.sessions - a.sessions || a.workoutIndex - b.workoutIndex || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(0, frequentLimit))
    .map((x) => x.id)

  return { recent: recentIds, frequent: frequentIds }
}
