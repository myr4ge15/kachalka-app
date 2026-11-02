import { localYmd, monthOf, shiftMonth } from './calendar.js'
import { sortDesc, mainEntries, currentExerciseShapes, entryExId, entryUnitMetric } from './entries.js'
import { leadingValue } from './metric.js'
import { isNonMuscleGroup, isNonMuscleSub } from './muscles.js'
import { totalTonnage } from './profileStats.js'

export function monthKey({ year, month }) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export function monthLabel(month) {
  return new Date(month.year, month.month, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

// Calendar months, local days, no stored snapshots: edits and deletions recalculate everything.
export function buildMonthlySummary(workouts, month, { now = new Date() } = {}) {
  const today = localYmd(now)
  const history = sortDesc(workouts).filter((w) => {
    const day = localYmd(w.performed_at)
    return day && day <= today
  })
  const key = monthKey(month)
  const previousKey = monthKey(shiftMonth(month, -1))
  const selected = history.filter((w) => localYmd(w.performed_at).startsWith(key))
  const previous = history.filter((w) => localYmd(w.performed_at).startsWith(previousKey))
  const shapes = currentExerciseShapes(history)
  const setsIn = (items) => items.reduce((sum, w) => sum + mainEntries(w).reduce((n, e) => n + (e.sets ?? []).length, 0), 0)
  const sets = setsIn(selected)
  const previousSets = setsIn(previous)
  const best = new Map()
  const records = new Map()
  const groups = new Map()
  const exercises = new Map()
  for (const w of [...history].reverse()) {
    const inMonth = localYmd(w.performed_at).startsWith(key)
    const seenExercises = new Set()
    for (const e of mainEntries(w)) {
      const id = entryExId(e)
      const shape = shapes.get(id)
      if (inMonth && id && e.sets?.length && !seenExercises.has(id)) {
        seenExercises.add(id)
        const rec = exercises.get(id) ?? { id, name: shape?.name ?? e.exercise?.name ?? e.name ?? 'Упражнение', workouts: 0 }
        rec.workouts++
        exercises.set(id, rec)
      }
      const metric = entryUnitMetric(e, shape?.metric)
      const value = leadingValue(metric, e.sets)
      const recordKey = `${id}:${metric}`
      const before = best.get(recordKey) ?? 0
      if (id && value > before) {
        if (inMonth && before > 0) records.set(recordKey, {
          id: recordKey, name: shape?.name ?? e.exercise?.name ?? e.name ?? 'Упражнение', metric, value,
        })
        best.set(recordKey, value)
      }
      const group = e.exercise?.muscle_group ?? e.muscle_group
      if (inMonth && group && !isNonMuscleGroup(group) && !isNonMuscleSub(e.exercise?.submuscle ?? e.submuscle)) {
        groups.set(group, (groups.get(group) ?? 0) + (e.sets ?? []).length)
      }
    }
  }
  return {
    available: history.length > 0,
    key, workouts: selected, count: selected.length,
    activeDays: new Set(selected.map((w) => localYmd(w.performed_at))).size,
    sets, tonnage: totalTonnage(selected), previousCount: previous.length,
    setsChange: previousSets > 0 ? Math.round((sets - previousSets) / previousSets * 100) : null,
    current: key === monthKey(monthOf(now)),
    favoriteExercise: [...exercises.values()].sort((a, b) => b.workouts - a.workouts || a.name.localeCompare(b.name, 'ru') || String(a.id).localeCompare(String(b.id)))[0] ?? null,
    records: [...records.values()].slice(-3).reverse(),
    groups: [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).slice(0, 2).map(([g]) => g),
  }
}
