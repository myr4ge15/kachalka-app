import { normMetric } from './metric.js'

// Активная цель выбранного упражнения для графика «Прогресса». Достигнутые и
// tombstone-цели не рисуем: их место — в истории достижений, а график должен
// показывать следующий ориентир.
export function selectProgressGoal(goals, exerciseId) {
  return (goals ?? []).find((g) =>
    !g?._deleted
    && !g?.achievedAt
    && String(g?.exerciseId) === String(exerciseId)
    && Number(g?.targetWeight) > 0
  ) ?? null
}

// Числовая модель подсказки. Для весовой цели с требованием повторов достижение
// одного только веса ещё не означает закрытие цели — UI отдельно сообщает,
// что осталось подтвердить нужное число повторов.
export function buildGoalGuide(goal, currentValue) {
  if (!goal) return null
  const metric = normMetric(goal.metric)
  const target = Number(goal.targetWeight) || 0
  const current = Math.max(0, Number(currentValue) || 0)
  const left = Math.max(0, target - current)
  const reps = metric === 'weight' && Number(goal.targetReps) > 0
    ? Math.round(Number(goal.targetReps))
    : 0
  return {
    metric,
    target,
    current,
    left,
    reps,
    valueReached: current >= target,
  }
}

