// Ближайший ориентир в уже отсортированном лидерборде. Модель чистая:
// не знает о React/Dexie/сети и не раскрывает никого вне переданного RLS-кэша.

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Строки из getCachedLeaderboard уже отсортированы каноническим cmpBoard.
// Копию сортируем ещё раз, чтобы модель не зависела от порядка устаревшего кэша.
function compareRows(a, b) {
  return (
    num(b.weight) - num(a.weight) ||
    num(b.reps) - num(a.reps) ||
    String(a.performed_at ?? '').localeCompare(String(b.performed_at ?? ''))
  )
}

export function findNearestRival(rows, userId) {
  if (!userId) return null

  const ranked = (rows ?? [])
    .filter((row) => row?.user_id)
    .slice()
    .sort(compareRows)
  const myIndex = ranked.findIndex((row) => row.user_id === userId)
  if (myIndex < 0 || ranked.length < 2) return null

  // Обычно ориентир — участник прямо выше. Для первого места показываем
  // ближайшего ниже, но нейтрально: это сосед, а не «преследователь».
  const rivalIndex = myIndex === 0 ? 1 : myIndex - 1
  const me = ranked[myIndex]
  const rival = ranked[rivalIndex]
  const weightGap = Math.abs(num(rival.weight) - num(me.weight))
  const repsGap = Math.abs(num(rival.reps) - num(me.reps))
  const tied = weightGap === 0 && repsGap === 0
  const gapMetric = weightGap > 0 ? 'weight' : 'reps'
  const gap = weightGap > 0 ? weightGap : repsGap
  const maxWeight = Math.max(num(me.weight), num(rival.weight), 1)

  return {
    me,
    rival,
    myPlace: myIndex + 1,
    rivalPlace: rivalIndex + 1,
    direction: myIndex === 0 ? 'below' : 'above',
    tied,
    gap,
    gapMetric,
    // Геометрия шкалы; цвет остаётся CSS-токеном.
    progress: Math.max(0, Math.min(100, Math.round(num(me.weight) / maxWeight * 100))),
  }
}
