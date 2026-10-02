// Ближайший ориентир в уже отсортированном лидерборде. Модель чистая:
// не знает о React/Dexie/сети и не раскрывает никого вне переданного RLS-кэша.

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Строки из getCachedLeaderboard уже отсортированы каноническим cmpBoard.
// Копию сортируем еще раз, чтобы модель не зависела от порядка устаревшего кэша.
function compareRows(a, b, metric) {
  return (
    (metric === 'weight' ? num(b.weight) - num(a.weight) : num(b.reps) - num(a.reps)) ||
    num(b.reps) - num(a.reps) ||
    String(a.performed_at ?? '').localeCompare(String(b.performed_at ?? ''))
  )
}

export function findNearestRival(rows, userId, metric = 'weight') {
  if (!userId) return null

  const ranked = (rows ?? [])
    .filter((row) => row?.user_id)
    .slice()
    .sort((a, b) => compareRows(a, b, metric))
  const myIndex = ranked.findIndex((row) => row.user_id === userId)
  if (myIndex < 0 || ranked.length < 2) return null

  // Обычно ориентир — участник прямо выше. Для первого места показываем
  // ближайшего ниже, но нейтрально: это сосед, а не «преследователь».
  const rivalIndex = myIndex === 0 ? 1 : myIndex - 1
  const me = ranked[myIndex]
  const rival = ranked[rivalIndex]
  // До сотых: 80.3 − 80.1 в двоичной арифметике = 0.20000000000000284.
  const weightGap = metric === 'weight' ? Math.round(Math.abs(num(rival.weight) - num(me.weight)) * 100) / 100 : 0
  const repsGap = Math.abs(num(rival.reps) - num(me.reps))
  const tied = weightGap === 0 && repsGap === 0
  const gapMetric = metric === 'time' ? 'time' : weightGap > 0 ? 'weight' : 'reps'
  const gap = weightGap > 0 ? weightGap : repsGap
  const field = metric === 'weight' ? 'weight' : 'reps'
  const maxWeight = Math.max(num(me[field]), num(rival[field]), 1)

  return {
    me,
    rival,
    myPlace: myIndex + 1,
    rivalPlace: rivalIndex + 1,
    direction: myIndex === 0 ? 'below' : 'above',
    tied,
    gap,
    gapMetric,
    metric,
    // Геометрия шкалы; цвет остается CSS-токеном.
    progress: Math.max(0, Math.min(100, Math.round(num(me[field]) / maxWeight * 100))),
  }
}
