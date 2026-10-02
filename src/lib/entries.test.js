import { describe, it, expect } from 'vitest'
import {
  entryExId,
  entryMetric,
  sortDesc,
  pickExerciseShape,
  currentExerciseShapes,
  entryUnitMetric,
  isCurrentUnit,
} from './entries.js'

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
  it('выкидывает удаленные и битые (null) строки', () => {
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
    // Любой порядок входа дает один и тот же результат (иначе якорь инсайтов флипал бы).
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

// РЕВЬЮ-КОДА-2026-10-02, п. 17: текущая форма упражнения — по свежему снимку.
describe('currentExerciseShapes', () => {
  const doc = (id, at, ex, extra = {}) => ({ id, performed_at: at, entries: [{ exercise_id: ex.id, exercise: ex, sets: [{ weight: 0, reps: 5 }] }], ...extra })
  it('берет имя/метрику из самого свежего по performed_at, порядок входа не важен', () => {
    const list = [
      doc('a', '2026-01-01T10:00:00Z', { id: 'x', name: 'Старое', metric: 'weight' }),
      doc('b', '2026-02-01T10:00:00Z', { id: 'x', name: 'Новое', metric: 'reps', is_bench_lift: true }),
    ]
    for (const l of [list, [...list].reverse()]) {
      expect(currentExerciseShapes(l).get('x')).toMatchObject({ name: 'Новое', metric: 'reps', legacy: false, is_bench_lift: true })
    }
  })
  it('удаленные тренировки не задают форму; легаси без metric → legacy:true, weight', () => {
    const list = [
      doc('a', '2026-01-01T10:00:00Z', { id: 'x', name: 'Легаси' }),
      doc('b', '2026-02-01T10:00:00Z', { id: 'x', name: 'Удалена', metric: 'time' }, { _deleted: 1 }),
    ]
    expect(currentExerciseShapes(list).get('x')).toMatchObject({ name: 'Легаси', metric: 'weight', legacy: true })
  })
  it('элементы ленты (плоские поля) тоже понимает', () => {
    const feed = [{ id: 'f', performed_at: '2026-01-01', entries: [{ exercise_id: 'x', name: 'Планка', metric: 'time', sets: [] }] }]
    expect(currentExerciseShapes(feed).get('x')).toMatchObject({ name: 'Планка', metric: 'time' })
  })
})

describe('entryUnitMetric / isCurrentUnit', () => {
  it('явный metric снимка — как есть', () => {
    expect(entryUnitMetric({ exercise: { metric: 'time' } }, 'weight')).toBe('time')
    expect(entryUnitMetric({ metric: 'reps' }, null)).toBe('reps')
  })
  it('легаси без metric: без веса у count-упражнения — его единица, иначе weight', () => {
    expect(entryUnitMetric({ sets: [{ weight: 0, reps: 10 }] }, 'reps')).toBe('reps')
    expect(entryUnitMetric({ sets: [{ weight: 10, reps: 10 }] }, 'reps')).toBe('weight')
    expect(entryUnitMetric({ sets: [{ weight: 0, reps: 10 }] }, 'weight')).toBe('weight')
    expect(entryUnitMetric({ sets: [] })).toBe('weight')
  })
  it('isCurrentUnit: без формы — сравнимо (старое поведение)', () => {
    expect(isCurrentUnit({ exercise: { metric: 'reps' } }, undefined)).toBe(true)
    expect(isCurrentUnit({ exercise: { metric: 'reps' } }, { metric: 'weight' })).toBe(false)
  })
})
