import { describe, it, expect } from 'vitest'
import { entryExId, entryMetric, sortDesc, pickExerciseShape } from './entries.js'

describe('entryExId', () => {
  it('плоский exercise_id (лента) и вложенный exercise.id (документ)', () => {
    expect(entryExId({ exercise_id: 'a' })).toBe('a')
    expect(entryExId({ exercise: { id: 'b' } })).toBe('b')
  })
  it('exercise_id имеет приоритет над вложенным', () => {
    expect(entryExId({ exercise_id: 'a', exercise: { id: 'b' } })).toBe('a')
  })
  it('нет id → null', () => {
    expect(entryExId({})).toBe(null)
  })
})

describe('entryMetric', () => {
  it('плоский metric (лента) и вложенный exercise.metric (документ)', () => {
    expect(entryMetric({ metric: 'reps' })).toBe('reps')
    expect(entryMetric({ exercise: { metric: 'time' } })).toBe('time')
  })
  it('неизвестная/отсутствующая метрика → weight', () => {
    expect(entryMetric({})).toBe('weight')
    expect(entryMetric({ metric: 'мусор' })).toBe('weight')
  })
})

describe('sortDesc', () => {
  it('новейшее сверху по performed_at, тай-брейк created_at', () => {
    const ws = [
      { id: 'a', performed_at: '2026-01-01', created_at: '2026-01-01T08:00:00Z' },
      { id: 'b', performed_at: '2026-03-01', created_at: '2026-03-01T08:00:00Z' },
      { id: 'c', performed_at: '2026-01-01', created_at: '2026-01-01T20:00:00Z' },
    ]
    expect(sortDesc(ws).map((w) => w.id)).toEqual(['b', 'c', 'a'])
  })
  it('выкидывает удалённые и битые (null) строки', () => {
    const ws = [null, { id: 'a', performed_at: '2026-01-01' }, { id: 'b', _deleted: 1, performed_at: '2026-02-01' }]
    expect(sortDesc(ws).map((w) => w.id)).toEqual(['a'])
  })
  it('не мутирует вход; пустой/undefined → []', () => {
    const ws = [{ id: 'a', performed_at: '1' }, { id: 'b', performed_at: '2' }]
    const copy = [...ws]
    sortDesc(ws)
    expect(ws).toEqual(copy)
    expect(sortDesc(undefined)).toEqual([])
    expect(sortDesc([])).toEqual([])
  })

  it('детерминизм при равных performed_at И created_at: тай-брейк по id, не зависит от порядка входа', () => {
    const same = { performed_at: '2026-01-01T10:00:00Z', created_at: '2026-01-01T10:00:00Z' }
    const a = { id: 'a', ...same }
    const b = { id: 'b', ...same }
    // Любой порядок входа даёт один и тот же результат (иначе якорь инсайтов флипал бы).
    expect(sortDesc([a, b]).map((w) => w.id)).toEqual(sortDesc([b, a]).map((w) => w.id))
  })
})

describe('pickExerciseShape', () => {
  it('полный снимок с валидными полями', () => {
    expect(pickExerciseShape({
      id: 'e1', name: 'Жим', muscle_group: 'грудь', submuscle: 'chest_upper',
      secondary: ['triceps'], is_bench_lift: true, metric: 'weight',
    })).toEqual({
      id: 'e1', name: 'Жим', muscle_group: 'грудь', submuscle: 'chest_upper',
      secondary: ['triceps'], is_bench_lift: true, metric: 'weight',
    })
  })

  it('фолбэки: muscle_group/submuscle → null, secondary → [], is_bench_lift → Boolean, metric → weight', () => {
    expect(pickExerciseShape({ id: 'e2', name: 'X' })).toEqual({
      id: 'e2', name: 'X', muscle_group: null, submuscle: null,
      secondary: [], is_bench_lift: false, metric: 'weight',
    })
  })

  it('metric нормализуется (невалидное → weight), совпадая с прежним поведением', () => {
    expect(pickExerciseShape({ id: 'e3', name: 'X', metric: 'reps' }).metric).toBe('reps')
    expect(pickExerciseShape({ id: 'e4', name: 'X', metric: 'мусор' }).metric).toBe('weight')
  })

  it('снимок содержит ровно 7 канонических полей (защита от «забыли поле»)', () => {
    expect(Object.keys(pickExerciseShape({ id: 'e5', name: 'X' })).sort()).toEqual(
      ['id', 'is_bench_lift', 'metric', 'muscle_group', 'name', 'secondary', 'submuscle']
    )
  })
})
