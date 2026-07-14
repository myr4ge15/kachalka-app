import { describe, it, expect } from 'vitest'
import { templateExercisesFromWorkout, defaultTemplateName } from './templateFromWorkout.js'

describe('templateExercisesFromWorkout', () => {
  it('весовое: подходы = число подходов, план = лучший рабочий подход', () => {
    const entries = [
      {
        exercise: { id: 'a', name: 'Жим', metric: 'weight' },
        sets: [
          { weight: 60, reps: 10 },
          { weight: 70, reps: 8 },   // топ по весу
          { weight: 65, reps: 9 },
        ],
      },
    ]
    const out = templateExercisesFromWorkout(entries)
    expect(out).toEqual([{ exercise: entries[0].exercise, sets: 3, reps: 8, weight: 70 }])
  })

  it('без веса (reps): вес шаблона = 0, план по лучшему числу повторов', () => {
    const entries = [
      {
        exercise: { id: 'b', name: 'Отжимания', metric: 'reps' },
        sets: [{ weight: 0, reps: 20 }, { weight: 0, reps: 25 }],
      },
    ]
    const out = templateExercisesFromWorkout(entries)
    expect(out).toEqual([{ exercise: entries[0].exercise, sets: 2, reps: 25, weight: 0 }])
  })

  it('пропускает упражнения без подходов и без id', () => {
    const entries = [
      { exercise: { id: 'a', metric: 'weight' }, sets: [] },
      { exercise: null, sets: [{ weight: 10, reps: 5 }] },
      { exercise: { id: 'c', metric: 'weight' }, sets: [{ weight: 40, reps: 6 }] },
    ]
    const out = templateExercisesFromWorkout(entries)
    expect(out).toHaveLength(1)
    expect(out[0].exercise.id).toBe('c')
  })

  it('reps минимум 1 при нулевых/битых повторах', () => {
    const out = templateExercisesFromWorkout([
      { exercise: { id: 'a', metric: 'weight' }, sets: [{ weight: 50, reps: 0 }] },
    ])
    expect(out[0].reps).toBe(1)
  })

  it('пустой/undefined вход → []', () => {
    expect(templateExercisesFromWorkout(undefined)).toEqual([])
    expect(templateExercisesFromWorkout([])).toEqual([])
  })
})

describe('defaultTemplateName', () => {
  it('форматирует «Тренировка ДД.ММ» от даты', () => {
    expect(defaultTemplateName('2026-07-14T10:00:00.000Z')).toBe('Тренировка 14.07')
  })
  it('битая/пустая дата → сегодня (без падения)', () => {
    expect(defaultTemplateName('не-дата')).toMatch(/^Тренировка \d{2}\.\d{2}$/)
    expect(defaultTemplateName()).toMatch(/^Тренировка \d{2}\.\d{2}$/)
  })
})
