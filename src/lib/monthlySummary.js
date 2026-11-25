import { localYmd, monthOf, shiftMonth } from './calendar.js'
import { sortDesc, mainEntries, currentExerciseShapes, entryExId } from './entries.js'
import { minePrs, recordKey } from './records.js'
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
  const records = new Map()
  for (const record of minePrs(history, shapes)) {
    if (localYmd(record.at).startsWith(key)) {
      const id = recordKey(record.exId, record.metric)
      records.set(id, { id, name: record.name, metric: record.metric, value: record.value })
    }
  }
  const groups = new Map()
  const exercises = new Map()
  for (const w of selected) {
    const seenExercises = new Set()
    for (const e of mainEntries(w)) {
      const id = entryExId(e)
      const shape = shapes.get(id)
      if (id && e.sets?.length && !seenExercises.has(id)) {
        seenExercises.add(id)
        const rec = exercises.get(id) ?? { id, name: shape?.name ?? e.exercise?.name ?? e.name ?? 'Упражнение', workouts: 0 }
        rec.workouts++
        exercises.set(id, rec)
      }
      const group = e.exercise?.muscle_group ?? e.muscle_group
      if (group && !isNonMuscleGroup(group) && !isNonMuscleSub(e.exercise?.submuscle ?? e.submuscle)) {
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
