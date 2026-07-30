import { describe, expect, it } from 'vitest'
import {
  exerciseFocusSummary, isExerciseIncomplete, pickActiveExerciseId,
} from './workoutFocus.js'

const entry = (id, sets, metric = 'weight') => ({
  exercise: { id, metric },
  sets,
})

describe('isExerciseIncomplete', () => {
  it('считает пустой или нулевой весовой подход незаполненным', () => {
    expect(isExerciseIncomplete(entry('a', []))).toBe(true)
    expect(isExerciseIncomplete(entry('a', [{ weight: 0, reps: 8 }]))).toBe(true)
    expect(isExerciseIncomplete(entry('a', [{ weight: 60, reps: 0 }]))).toBe(true)
  })

  it('не требует вес у метрик reps и time', () => {
    expect(isExerciseIncomplete(entry('a', [{ weight: 0, reps: 8 }], 'reps'))).toBe(false)
    expect(isExerciseIncomplete(entry('a', [{ weight: 0, reps: 60 }], 'time'))).toBe(false)
  })
})

describe('pickActiveExerciseId', () => {
  const filled = entry('filled', [{ weight: 60, reps: 8 }])
  const incomplete = entry('incomplete', [{ weight: 0, reps: 0 }])

  it('сохраняет текущий id после изменения массива', () => {
    expect(pickActiveExerciseId([incomplete, filled], 'filled', {
      preferIncomplete: true,
    })).toBe('filled')
  })

  it('для редактирования выбирает первое незаполненное упражнение', () => {
    expect(pickActiveExerciseId([filled, incomplete], null, {
      preferIncomplete: true,
    })).toBe('incomplete')
  })

  it('иначе выбирает первое упражнение и устойчив к пустому составу', () => {
    expect(pickActiveExerciseId([filled, incomplete], null)).toBe('filled')
    expect(pickActiveExerciseId([], 'missing')).toBeNull()
  })
})

describe('exerciseFocusSummary', () => {
  it('собирает число подходов и лучший фактический подход', () => {
    expect(exerciseFocusSummary(entry('bench', [
      { weight: 65, reps: 6 },
      { weight: 65, reps: 8 },
    ]))).toEqual({
      setCount: 2,
      doneCount: 0,
      allDone: false,
      best: '65×8',
      text: '2 подхода · 65×8',
    })
  })

  it('показывает частичный и полный прогресс по явным отметкам', () => {
    const bench = entry('bench', [
      { weight: 65, reps: 6, _k: 'a' },
      { weight: 65, reps: 8, _k: 'b' },
    ])

    expect(exerciseFocusSummary(bench, new Set(['bench::a']))).toMatchObject({
      doneCount: 1,
      allDone: false,
      text: 'выполнено 1 из 2 · 65×8',
    })
    expect(exerciseFocusSummary(bench, new Set(['bench::a', 'bench::b']))).toMatchObject({
      allDone: true,
      text: '✓ выполнено · 2 подхода · 65×8',
    })
  })

  it('отмеченный подход без значений не приписывает «значения не указаны»', () => {
    expect(exerciseFocusSummary(
      entry('bench', [{ weight: 0, reps: 0, _k: 'a' }]),
      new Set(['bench::a'])
    )).toMatchObject({ text: '✓ выполнено · 1 подход' })
  })

  it('нейтрально показывает отсутствие значений', () => {
    expect(exerciseFocusSummary(entry('bench', [{ weight: 0, reps: 0 }]))).toMatchObject({
      best: null,
      text: '1 подход · значения не указаны',
    })
  })

  it.each([
    ['reps', 12, '1 подход · 12'],
    ['time', 90, '1 подход · 1:30'],
  ])('форматирует компактный итог для метрики %s', (metric, reps, text) => {
    expect(exerciseFocusSummary(entry('count', [{ weight: 0, reps }], metric))).toMatchObject({
      text,
    })
  })
})
