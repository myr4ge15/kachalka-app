import { describe, expect, it } from 'vitest'
import { formatWorkoutDuration, workoutFinishSummary } from './workoutFinish.js'

describe('workoutFinishSummary', () => {
  it('считает упражнения, подходы и весовой тоннаж сохранённой тренировки', () => {
    const summary = workoutFinishSummary({
      entries: [
        {
          exercise: { metric: 'weight' },
          sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 4 }],
        },
        {
          exercise: { metric: 'reps' },
          sets: [{ weight: 0, reps: 12 }],
        },
      ],
    })

    expect(summary).toEqual({
      exerciseCount: 2,
      setCount: 3,
      tonnage: 720,
      durationSeconds: null,
    })
  })

  it('не считает пустые упражнения и принимает только явную длительность', () => {
    const summary = workoutFinishSummary({
      created_at: '2026-07-30T10:00:00Z',
      updated_at: '2026-07-30T12:00:00Z',
      duration_seconds: 3670,
      entries: [{ sets: [] }],
    })

    expect(summary).toEqual({
      exerciseCount: 0,
      setCount: 0,
      tonnage: 0,
      durationSeconds: 3670,
    })
  })
})

describe('formatWorkoutDuration', () => {
  it('форматирует минуты и часы без секундного шума', () => {
    expect(formatWorkoutDuration(40)).toBe('1 мин')
    expect(formatWorkoutDuration(45 * 60)).toBe('45 мин')
    expect(formatWorkoutDuration(75 * 60)).toBe('1 ч 15 мин')
    expect(formatWorkoutDuration(null)).toBeNull()
  })
})
