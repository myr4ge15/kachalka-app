import { describe, it, expect } from 'vitest'
import { selectDirtyForMigration } from './migration.js'

describe('selectDirtyForMigration', () => {
  const A = 'user-a'
  const B = 'user-b'

  it('переносит только _dirty/_deleted тренировки текущего юзера', () => {
    const workouts = [
      { id: 'w1', user_id: A, _dirty: 1 },        // ← переносим
      { id: 'w2', user_id: A, _deleted: 1 },      // ← переносим (tombstone)
      { id: 'w3', user_id: A },                   // чистая — не переносим (есть на сервере)
      { id: 'w4', user_id: B, _dirty: 1 },        // чужая — не переносим
    ]
    const got = selectDirtyForMigration(workouts, [], A)
    expect(got.workouts.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
  })

  it('берёт операции outbox только для переносимых тренировок', () => {
    const workouts = [
      { id: 'w1', user_id: A, _dirty: 1 },
      { id: 'w3', user_id: A }, // чистая
      { id: 'w4', user_id: B, _dirty: 1 },
    ]
    const outbox = [
      { seq: 1, workoutId: 'w1', type: 'upsert' }, // ← переносим
      { seq: 2, workoutId: 'w3', type: 'upsert' }, // чистая w3 не переносится → и op не нужна
      { seq: 3, workoutId: 'w4', type: 'upsert' }, // чужая
    ]
    const got = selectDirtyForMigration(workouts, outbox, A)
    expect(got.outbox.map((o) => o.workoutId)).toEqual(['w1'])
  })

  it('пустые/undefined входы → пустой результат', () => {
    expect(selectDirtyForMigration(undefined, undefined, A)).toEqual({ workouts: [], outbox: [] })
    expect(selectDirtyForMigration([], [], A)).toEqual({ workouts: [], outbox: [] })
  })

  it('игнорирует битые строки (null) во входе', () => {
    const workouts = [null, { id: 'w1', user_id: A, _dirty: 1 }]
    const outbox = [null, { workoutId: 'w1', type: 'delete' }]
    const got = selectDirtyForMigration(workouts, outbox, A)
    expect(got.workouts.map((w) => w.id)).toEqual(['w1'])
    expect(got.outbox).toHaveLength(1)
  })
})
