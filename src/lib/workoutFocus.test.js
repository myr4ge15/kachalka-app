import { describe, expect, it } from 'vitest'
import { isExerciseIncomplete, pickActiveExerciseId } from './workoutFocus.js'

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
