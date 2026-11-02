import { describe, expect, it } from 'vitest'
import { buildMonthlySummary, monthKey, monthLabel } from './monthlySummary.js'

const month = { year: 2026, month: 9 }
const now = new Date(2026, 10, 2, 12)
const workout = (id, day, value = 60, metric = 'weight', extra = {}) => ({
  id, performed_at: `${day}T12:00:00`, entries: [{ exercise_id: 'bench', exercise: { name: 'Жим', metric, muscle_group: 'грудь' }, sets: [{ weight: value, reps: value }] }], ...extra,
})
const summary = (items, selected = month) => buildMonthlySummary(items, selected, { now })

describe('monthly summary', () => {
  it('picks the most frequent exercise by workouts, deduplicating entries and ignoring warmup and other months', () => {
    const a = workout('a', '2026-10-01')
    const b = workout('b', '2026-10-02')
    const rare = { exercise_id: 'rare', exercise: { name: 'Присед', metric: 'weight' }, sets: Array(20).fill({ weight: 50, reps: 5 }) }
    a.entries.push(a.entries[0], rare, { ...rare, phase: 'warmup' })
    const result = summary([a, b, workout('old', '2026-09-30'), workout('deleted', '2026-10-03', 60, 'weight', { _deleted: true })])
    expect(result.favoriteExercise).toEqual({ id: 'bench', name: 'Жим', workouts: 2 })
    expect(summary([]).favoriteExercise).toBeNull()
  })
  it('counts monthly weight × reps only, excluding warmup, cooldown, other metrics and deleted workouts', () => {
    const w = workout('1', '2026-10-01', 10)
    w.entries = [
      ...w.entries,
      { ...w.entries[0], phase: 'warmup' },
      { ...w.entries[0], phase: 'cooldown' },
      ...['reps', 'time', 'distance'].map((metric) => ({ ...w.entries[0], exercise: { metric } })),
    ]
    expect(summary([w, workout('old', '2026-09-30'), workout('deleted', '2026-10-02', 100, 'weight', { _deleted: true })]).tonnage).toBe(100)
    expect(summary([]).tonnage).toBe(0)
  })
  it('stays hidden until the first non-deleted, non-future workout', () => {
    expect(summary([]).available).toBe(false)
    expect(summary([workout('1', '2026-10-01', 60, 'weight', { _deleted: true }), workout('2', '2026-12-01')]).available).toBe(false)
    expect(summary([workout('1', '2026-11-01')])).toMatchObject({ available: true, count: 0, setsChange: null })
  })
  it('uses calendar boundaries and counts distinct local days', () => {
    const result = summary([workout('1', '2026-09-30'), workout('2', '2026-10-01'), workout('3', '2026-10-01'), workout('4', '2026-10-31'), workout('5', '2026-11-01')])
    expect(result).toMatchObject({ count: 3, activeDays: 2, sets: 3, previousCount: 1, setsChange: 200, current: false })
    expect(summary([workout('a', '2025-12-31'), workout('b', '2026-01-01')], { year: 2026, month: 0 }).previousCount).toBe(1)
  })
  it('compares records with all preceding history and never calls the first entry a record', () => {
    expect(summary([workout('1', '2026-08-01', 100), workout('2', '2026-09-01', 60), workout('3', '2026-10-01', 80)]).records).toEqual([])
    expect(summary([workout('1', '2026-09-01', 60), workout('2', '2026-10-01', 80), workout('3', '2026-10-02', 90)]).records).toMatchObject([{ value: 90 }])
    expect(summary([workout('1', '2026-10-01')]).records).toEqual([])
  })
  it.each(['weight', 'reps', 'time', 'distance'])('keeps %s records in their own units', (metric) => {
    expect(summary([workout('1', '2026-08-01', 100, metric === 'weight' ? 'reps' : 'weight'), workout('2', '2026-09-01', 5, metric), workout('3', '2026-10-01', 10, metric)]).records).toMatchObject([{ metric, value: 10 }])
  })
  it('excludes warmup/cooldown from sets, records and muscle distribution', () => {
    const w = workout('1', '2026-10-01')
    w.entries.push({ ...w.entries[0], phase: 'warmup' }, { ...w.entries[0], phase: 'cooldown' }, { exercise: { muscle_group: 'кардио', metric: 'time' }, sets: [{ reps: 60 }] })
    expect(summary([w])).toMatchObject({ sets: 2, groups: ['грудь'], records: [] })
  })
  it('recalculates after edits and deletion; caps records at three', () => {
    const before = workout('1', '2026-09-01')
    const after = workout('2', '2026-10-01', 80)
    before.entries = Array.from({ length: 4 }, (_, i) => ({ ...before.entries[0], exercise_id: String(i) }))
    after.entries = Array.from({ length: 4 }, (_, i) => ({ ...after.entries[0], exercise_id: String(i) }))
    expect(summary([before, after]).records).toHaveLength(3)
    expect(summary([before, { ...after, _deleted: true }]).count).toBe(0)
    expect(summary([before, { ...after, entries: [] }]).sets).toBe(0)
  })
  it('uses local dates around midnight and handles invalid dates', () => {
    const w = workout('1', '2026-10-01')
    w.performed_at = new Date(2026, 9, 1, 0, 15).toISOString()
    expect(summary([w, { id: 'bad', performed_at: 'invalid' }]).count).toBe(1)
    expect(monthKey({ year: 2027, month: 0 })).toBe('2027-01')
    expect(monthLabel(month)).toContain('октябрь')
    expect(summary([workout('1', '2026-11-01')], { year: 2026, month: 10 }).current).toBe(true)
  })
})
