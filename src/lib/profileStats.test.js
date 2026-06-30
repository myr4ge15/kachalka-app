import { describe, it, expect } from 'vitest'
import {
  workoutsThisMonth,
  personalRecords,
  favExercise,
  summarize,
  currentBest,
  currentBestValue,
  goalProgress,
} from './profileStats.js'

const wk = (id, performed_at, entries) => ({ id, performed_at, entries })

describe('workoutsThisMonth', () => {
  it('считает только тренировки текущего календарного месяца (локально)', () => {
    const now = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15).toISOString()
    // прошлый месяц
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()
    const workouts = [
      wk('w1', thisMonth, []),
      wk('w2', thisMonth, []),
      wk('w3', prev, []),
    ]
    expect(workoutsThisMonth(workouts)).toBe(2)
  })
  it('без даты/пусто → 0', () => {
    expect(workoutsThisMonth([{ id: 'x' }])).toBe(0)
    expect(workoutsThisMonth([])).toBe(0)
    expect(workoutsThisMonth(undefined)).toBe(0)
  })
})

describe('personalRecords', () => {
  it('жим лёжа сверху, далее весовые по убыванию, не-весовые в конце', () => {
    const workouts = [
      wk('w1', '2026-01-01', [
        { exercise_id: 'bench', exercise: { id: 'bench', name: 'Жим', is_bench_lift: true }, sets: [{ weight: 90, reps: 1 }] },
      ]),
      wk('w2', '2026-01-02', [
        { exercise_id: 'squat', exercise: { id: 'squat', name: 'Присед' }, sets: [{ weight: 120, reps: 3 }] },
      ]),
      wk('w3', '2026-01-03', [
        { exercise_id: 'pull', exercise: { id: 'pull', name: 'Подтягивания', metric: 'reps' }, metric: 'reps', sets: [{ weight: 0, reps: 12 }] },
      ]),
    ]
    const recs = personalRecords(workouts)
    expect(recs.map((r) => r.exId)).toEqual(['bench', 'squat', 'pull'])
    expect(recs[0].isBench).toBe(true)
    expect(recs[2].metric).toBe('reps')
  })
})

describe('favExercise', () => {
  it('упражнение с наибольшим числом подходов', () => {
    const workouts = [
      wk('w1', '2026-01-01', [
        { exercise_id: 'a', exercise: { id: 'a', name: 'A' }, sets: [{}, {}, {}] },
        { exercise_id: 'b', exercise: { id: 'b', name: 'B' }, sets: [{}] },
      ]),
      wk('w2', '2026-01-02', [
        { exercise_id: 'b', exercise: { id: 'b', name: 'B' }, sets: [{}, {}, {}] },
      ]),
    ]
    expect(favExercise(workouts)).toMatchObject({ exId: 'b', sets: 4 })
  })
  it('нет подходов → null', () => {
    expect(favExercise([])).toBeNull()
  })
})

describe('summarize', () => {
  it('пустая история → нули/[]/null без падений', () => {
    expect(summarize([])).toEqual({
      totalWorkouts: 0,
      workoutsThisMonth: 0,
      personalRecords: [],
      favExercise: null,
    })
    expect(summarize(undefined).totalWorkouts).toBe(0)
  })
})

describe('currentBest', () => {
  it('лучший фактический вес по упражнению', () => {
    const workouts = [
      wk('w1', '2026-01-01', [{ exercise_id: 'a', exercise: { id: 'a' }, sets: [{ weight: 60 }] }]),
      wk('w2', '2026-01-02', [{ exercise_id: 'a', exercise: { id: 'a' }, sets: [{ weight: 80 }] }]),
    ]
    expect(currentBest(workouts, 'a')).toBe(80)
  })
  it('нет упражнения / нет id → 0', () => {
    expect(currentBest([], 'a')).toBe(0)
    expect(currentBest([], null)).toBe(0)
  })
})

describe('currentBestValue', () => {
  it('reps-метрика → макс. повторов', () => {
    const workouts = [
      wk('w1', '2026-01-01', [{ exercise_id: 'p', exercise: { id: 'p' }, sets: [{ weight: 0, reps: 10 }] }]),
      wk('w2', '2026-01-02', [{ exercise_id: 'p', exercise: { id: 'p' }, sets: [{ weight: 0, reps: 14 }] }]),
    ]
    expect(currentBestValue(workouts, 'p', 'reps')).toBe(14)
  })
})

describe('goalProgress', () => {
  it('процент достижения, обрезка до 100', () => {
    expect(goalProgress(75, 100)).toBe(75)
    expect(goalProgress(120, 100)).toBe(100)
    expect(goalProgress(0, 100)).toBe(0)
  })
  it('target ≤ 0 → 0 (без деления на ноль)', () => {
    expect(goalProgress(50, 0)).toBe(0)
    expect(goalProgress(50, undefined)).toBe(0)
  })
})
