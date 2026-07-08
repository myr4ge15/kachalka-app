import { describe, it, expect } from 'vitest'
import { pickLastSets } from './lastSets.js'

// Заготовки тренировок (денормализованный вид, как в Dexie workouts).
const wk = (id, performed_at, entries, extra = {}) => ({
  id, performed_at, created_at: performed_at, entries, _deleted: 0, ...extra,
})
const en = (exId, sets) => ({ exercise_id: exId, sets })

describe('pickLastSets', () => {
  it('возвращает подходы из самой свежей тренировки с этим упражнением', () => {
    const workouts = [
      wk('w1', '2026-01-01', [en('bench', [{ weight: 80, reps: 8 }])]),
      wk('w2', '2026-03-01', [en('bench', [{ weight: 100, reps: 5 }, { weight: 100, reps: 4 }])]),
      wk('w3', '2026-02-01', [en('bench', [{ weight: 90, reps: 6 }])]),
    ]
    expect(pickLastSets(workouts, 'bench')).toEqual([
      { weight: 100, reps: 5 },
      { weight: 100, reps: 4 },
    ])
  })

  it('null, если упражнение ещё не делали', () => {
    const workouts = [wk('w1', '2026-01-01', [en('bench', [{ weight: 80, reps: 8 }])])]
    expect(pickLastSets(workouts, 'squat')).toBe(null)
  })

  it('пропускает удалённые тренировки', () => {
    const workouts = [
      wk('w2', '2026-03-01', [en('bench', [{ weight: 120, reps: 3 }])], { _deleted: 1 }),
      wk('w1', '2026-01-01', [en('bench', [{ weight: 80, reps: 8 }])]),
    ]
    expect(pickLastSets(workouts, 'bench')).toEqual([{ weight: 80, reps: 8 }])
  })

  it('тай-брейк по created_at при равной дате тренировки', () => {
    const workouts = [
      { id: 'a', performed_at: '2026-05-01', created_at: '2026-05-01T09:00:00Z', _deleted: 0,
        entries: [en('bench', [{ weight: 70, reps: 10 }])] },
      { id: 'b', performed_at: '2026-05-01', created_at: '2026-05-01T20:00:00Z', _deleted: 0,
        entries: [en('bench', [{ weight: 75, reps: 9 }])] },
    ]
    expect(pickLastSets(workouts, 'bench')).toEqual([{ weight: 75, reps: 9 }])
  })

  it('пропускает тренировку, где упражнение есть, но без валидных подходов', () => {
    const workouts = [
      wk('w2', '2026-03-01', [en('bench', [])]),
      wk('w1', '2026-01-01', [en('bench', [{ weight: 60, reps: 12 }])]),
    ]
    expect(pickLastSets(workouts, 'bench')).toEqual([{ weight: 60, reps: 12 }])
  })

  it('матчит и по вложенному exercise.id (денормализованный снимок)', () => {
    const workouts = [
      { id: 'w1', performed_at: '2026-01-01', created_at: '2026-01-01', _deleted: 0,
        entries: [{ exercise: { id: 'bench' }, sets: [{ weight: 50, reps: 5 }] }] },
    ]
    expect(pickLastSets(workouts, 'bench')).toEqual([{ weight: 50, reps: 5 }])
  })

  it('устойчив к мусору на входе', () => {
    expect(pickLastSets(null, 'bench')).toBe(null)
    expect(pickLastSets([], 'bench')).toBe(null)
    expect(pickLastSets([wk('w', '2026-01-01', [])], '')).toBe(null)
  })
})
