import { describe, it, expect } from 'vitest'
import { cleanWorkoutForExport, buildExport, exportFilename } from './exportWorkout.js'

const w1 = {
  id: 'w1', user_id: 'u1', performed_at: '2026-01-10', created_at: '2026-01-09',
  updated_at: '2026-01-11', _dirty: 1, _deleted: 0,
  entries: [
    { exercise: { id: 'ex1', name: 'Жим', muscle_group: 'грудь', metric: 'weight' }, sets: [{ weight: 100, reps: 5 }] },
    { exercise: { id: 'ex2', name: 'Планка', muscle_group: 'пресс', metric: 'time' }, sets: [{ weight: 0, reps: 60 }] },
  ],
}

describe('cleanWorkoutForExport', () => {
  it('оставляет только публичные поля, режет служебные флаги синка', () => {
    const c = cleanWorkoutForExport(w1)
    expect(c).toEqual({
      id: 'w1', performed_at: '2026-01-10', created_at: '2026-01-09',
      entries: [
        { exercise: { id: 'ex1', name: 'Жим', muscle_group: 'грудь', metric: 'weight' }, sets: [{ weight: 100, reps: 5 }] },
        { exercise: { id: 'ex2', name: 'Планка', muscle_group: 'пресс', metric: 'time' }, sets: [{ weight: 0, reps: 60 }] },
      ],
    })
    expect(c).not.toHaveProperty('user_id')
    expect(c).not.toHaveProperty('_dirty')
    expect(c).not.toHaveProperty('updated_at')
  })

  it('фолбэки: exercise_id вместо exercise, метрика по умолчанию weight, NaN-подходы → 0', () => {
    const c = cleanWorkoutForExport({
      entries: [{ exercise_id: 'x9', sets: [{ weight: 'abc', reps: undefined }, {}] }],
    })
    expect(c.id).toBe(null)
    expect(c.entries[0].exercise).toEqual({ id: 'x9', name: '—', muscle_group: null, metric: 'weight' })
    expect(c.entries[0].sets).toEqual([{ weight: 0, reps: 0 }, { weight: 0, reps: 0 }])
  })

  it('нет entries/sets → пустые массивы, без падения', () => {
    expect(cleanWorkoutForExport({}).entries).toEqual([])
    expect(cleanWorkoutForExport(undefined).entries).toEqual([])
    expect(cleanWorkoutForExport({ entries: [{ exercise: { id: 'a', name: 'A' } }] }).entries[0].sets).toEqual([])
  })
})

describe('buildExport', () => {
  it('конверт с метаданными; одна тренировка → count 1', () => {
    const now = new Date('2026-02-01T12:00:00.000Z')
    const out = buildExport(w1, '1.2.3', now)
    expect(out.app).toBe('Журнал тренировок')
    expect(out.schema).toBe('workouts-export/v1')
    expect(out.app_version).toBe('1.2.3')
    expect(out.exported_at).toBe('2026-02-01T12:00:00.000Z')
    expect(out.count).toBe(1)
    expect(out.workouts).toHaveLength(1)
  })

  it('массив тренировок → count = длина; app_version по умолчанию dev', () => {
    const out = buildExport([w1, w1])
    expect(out.count).toBe(2)
    expect(out.app_version).toBe('dev')
  })

  it('now как ISO-строка тоже принимается', () => {
    expect(buildExport(w1, 'x', '2026-02-01T00:00:00.000Z').exported_at).toBe('2026-02-01T00:00:00.000Z')
  })

  it('невалидный now → exported_at null (без throw)', () => {
    expect(buildExport(w1, 'x', new Date('нет')).exported_at).toBe(null)
    expect(buildExport(w1, 'x', 'мусор').exported_at).toBe(null)
  })
})

describe('exportFilename', () => {
  it('одна тренировка → workout-<дата тренировки>.json', () => {
    expect(exportFilename(w1)).toBe('workout-2026-01-10.json')
    expect(exportFilename([w1])).toBe('workout-2026-01-10.json')
  })

  it('несколько → workouts-N-<дата выгрузки>.json', () => {
    const now = new Date('2026-02-01T00:00:00.000Z')
    expect(exportFilename([w1, w1], now)).toBe('workouts-2-2026-02-01.json')
  })

  it('невалидная дата тренировки → фолбэк на дату выгрузки', () => {
    const now = new Date('2026-02-01T00:00:00.000Z')
    expect(exportFilename([{ performed_at: 'мусор' }], now)).toBe('workout-2026-02-01.json')
  })

  it('невалидны и дата тренировки, и now → workout-export.json', () => {
    // NB: performed_at должен быть именно НЕпарсимым (new Date(null) дало бы валидный 1970 год).
    expect(exportFilename([{ performed_at: 'мусор' }], new Date('нет'))).toBe('workout-export.json')
  })
})
