import { describe, expect, it } from 'vitest'
import {
  exerciseFocusSummary, isExerciseIncomplete, nextFocusRequest, pickActiveExerciseId,
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

describe('nextFocusRequest', () => {
  it('тап внутри уже активной карточки фиксирует заявку без reveal', () => {
    // Карточка выбрана автоматически (id заявки ещё null) — центрировать нечего,
    // иначе экран уезжает под пальцем и следующий тап бьёт мимо подхода.
    expect(nextFocusRequest({ id: null, revision: 0 }, 'bench', 'bench')).toEqual({
      id: 'bench', revision: 0,
    })
  })

  it('переход на другое упражнение поднимает revision', () => {
    expect(nextFocusRequest({ id: null, revision: 0 }, 'pullup', 'bench')).toEqual({
      id: 'pullup', revision: 1,
    })
    expect(nextFocusRequest({ id: 'bench', revision: 3 }, 'pullup', 'bench')).toEqual({
      id: 'pullup', revision: 4,
    })
  })

  it('повторная заявка того же упражнения не двигает экран', () => {
    const request = { id: 'bench', revision: 2 }

    expect(nextFocusRequest(request, 'bench', 'bench')).toBe(request)
    // Сброс фокуса (пустой состав) тоже не reveal — прокручивать нечего.
    expect(nextFocusRequest(request, null, 'bench')).toEqual({ id: null, revision: 2 })
  })
})

describe('exerciseFocusSummary', () => {
  it('перечисляет фактические подходы, а не один лучший', () => {
    expect(exerciseFocusSummary(entry('bench', [
      { weight: 65, reps: 6 },
      { weight: 65, reps: 8 },
    ]))).toEqual({
      setCount: 2,
      doneCount: 0,
      allDone: false,
      sets: '65×6 · 65×8',
      text: '2 подхода · 65×6 · 65×8',
    })
  })

  it('схлопывает одинаковые подходы подряд', () => {
    expect(exerciseFocusSummary(entry('bench', [
      { weight: 60, reps: 10 },
      { weight: 60, reps: 10 },
      { weight: 60, reps: 10 },
      { weight: 50, reps: 12 },
    ]))).toMatchObject({ text: '4 подхода · 60×10 ×3 · 50×12' })
  })

  it('обрезает длинный список подходов многоточием', () => {
    expect(exerciseFocusSummary(entry('bench', [
      { weight: 40, reps: 12 },
      { weight: 45, reps: 11 },
      { weight: 50, reps: 10 },
      { weight: 55, reps: 9 },
      { weight: 60, reps: 8 },
    ]))).toMatchObject({ text: '5 подходов · 40×12 · 45×11 · 50×10 · 55×9 · …' })
  })

  it('показывает пропуск незаполненного подхода как «—»', () => {
    expect(exerciseFocusSummary(entry('bench', [
      { weight: 60, reps: 8 },
      { weight: 60, reps: 0 },
    ]))).toMatchObject({ text: '2 подхода · 60×8 · —' })
  })

  it('показывает частичный и полный прогресс по явным отметкам', () => {
    const bench = entry('bench', [
      { weight: 65, reps: 6, _k: 'a' },
      { weight: 65, reps: 8, _k: 'b' },
    ])

    expect(exerciseFocusSummary(bench, new Set(['bench::a']))).toMatchObject({
      doneCount: 1,
      allDone: false,
      text: 'выполнено 1 из 2 · 65×6 · 65×8',
    })
    expect(exerciseFocusSummary(bench, new Set(['bench::a', 'bench::b']))).toMatchObject({
      allDone: true,
      text: '✓ выполнено · 2 подхода · 65×6 · 65×8',
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
      sets: null,
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
