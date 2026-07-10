import { describe, it, expect } from 'vitest'
import { buildHomeSummary, fmtDaysAgo, fmtDays } from './homeSummary.js'

function wk({ id, at, entries }) {
  return {
    id,
    user_id: 'me',
    performed_at: at,
    created_at: at,
    entries: (entries ?? []).map((e) => ({
      exercise_id: e.exId,
      exercise: {
        id: e.exId,
        name: e.name ?? e.exId,
        muscle_group: e.group ?? null,
        is_bench_lift: Boolean(e.bench),
        metric: e.metric ?? 'weight',
      },
      sets: e.sets ?? [],
    })),
  }
}
const S = (weight, reps) => ({ weight, reps })
const NOW = new Date('2026-07-10T12:00:00')
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('buildHomeSummary', () => {
  it('пустая история → hasData:false и нули', () => {
    const s = buildHomeSummary({ workouts: [], goals: [], now: NOW })
    expect(s.hasData).toBe(false)
    expect(s.streak).toBe(0)
    expect(s.lastWorkout).toBeNull()
    expect(s.latestPr).toBeNull()
  })

  it('последняя тренировка: дни назад и теги групп', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(2), entries: [{ exId: 'bp', name: 'Жим', group: 'грудь', bench: true, sets: [S(80, 5)] }] }),
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.hasData).toBe(true)
    expect(s.lastWorkout.daysAgo).toBe(2)
    expect(s.lastWorkout.tags).toContain('грудь')
  })

  it('тоннаж месяца и дельта против прошлого', () => {
    const list = [
      wk({ id: 'r', at: daysAgo(5), entries: [{ exId: 'x', sets: [S(100, 10)] }] }),  // 1000
      wk({ id: 'o', at: daysAgo(40), entries: [{ exId: 'x', sets: [S(80, 10)] }] }),   // 800
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.tonnage.month).toBe(1000)
    expect(s.tonnage.prevMonth).toBe(800)
    expect(s.tonnage.pct).toBe(25)
  })

  it('последний рекорд — самый свежий момент превышения', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(95, 3)] }] }),
      wk({ id: 'mid', at: daysAgo(7), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(90, 3)] }] }),
      wk({ id: 'old', at: daysAgo(14), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(80, 3)] }] }),
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.latestPr).toBeTruthy()
    expect(s.latestPr.value).toBe(95)
    expect(s.latestPr.at).toBe(list[0].performed_at)
  })

  it('забытая группа — самая просроченная', () => {
    const list = [
      wk({ id: 'legs', at: daysAgo(18), entries: [{ exId: 'sq', group: 'ноги', sets: [S(100, 5)] }] }),
      wk({ id: 'chest', at: daysAgo(1), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.nextFocus.group).toBe('ноги')
    expect(s.nextFocus.daysAgo).toBe(18)
  })

  it('ближайшая цель — с наибольшим прогрессом', () => {
    const list = [wk({ id: 'a', at: daysAgo(1), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(90, 5)] }] })]
    const goals = [
      { exerciseId: 'bp', exerciseName: 'Жим', metric: 'weight', targetWeight: 100, achievedAt: null },
      { exerciseId: 'sq', exerciseName: 'Присед', metric: 'weight', targetWeight: 200, achievedAt: null },
    ]
    const s = buildHomeSummary({ workouts: list, goals, now: NOW })
    expect(s.nearestGoal.name).toBe('Жим')
    expect(s.nearestGoal.pct).toBe(90)
    expect(s.nearestGoal.left).toBe(10)
  })

  it('достигнутые/удалённые цели не считаются', () => {
    const list = [wk({ id: 'a', at: daysAgo(1), entries: [{ exId: 'bp', name: 'Жим', sets: [S(90, 5)] }] })]
    const goals = [{ exerciseId: 'bp', exerciseName: 'Жим', metric: 'weight', targetWeight: 100, achievedAt: '2026-01-01' }]
    const s = buildHomeSummary({ workouts: list, goals, now: NOW })
    expect(s.nearestGoal).toBeNull()
  })
})

describe('fmtDaysAgo', () => {
  it('форматы дней', () => {
    expect(fmtDaysAgo(0)).toBe('сегодня')
    expect(fmtDaysAgo(1)).toBe('вчера')
    expect(fmtDaysAgo(2)).toBe('2 дня назад')
    expect(fmtDaysAgo(5)).toBe('5 дней назад')
    expect(fmtDaysAgo(21)).toBe('21 день назад')
  })
})

describe('fmtDays', () => {
  it('длительность без «назад», склонение по числу', () => {
    expect(fmtDays(1)).toBe('1 день')
    expect(fmtDays(2)).toBe('2 дня')
    expect(fmtDays(18)).toBe('18 дней')
    expect(fmtDays(21)).toBe('21 день')
  })
})
