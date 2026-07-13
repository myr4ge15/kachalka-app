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
    expect(selectDirtyForMigration(undefined, undefined, A))
      .toEqual({ workouts: [], outbox: [], exercises: [], exOutbox: [] })
    expect(selectDirtyForMigration([], [], A))
      .toEqual({ workouts: [], outbox: [], exercises: [], exOutbox: [] })
  })

  it('игнорирует битые строки (null) во входе', () => {
    const workouts = [null, { id: 'w1', user_id: A, _dirty: 1 }]
    const outbox = [null, { workoutId: 'w1', type: 'delete' }]
    const got = selectDirtyForMigration(workouts, outbox, A)
    expect(got.workouts.map((w) => w.id)).toEqual(['w1'])
    expect(got.outbox).toHaveLength(1)
  })

  // --- Перенос кастомных упражнений + ex_outbox (FK) ------------------------
  it('переносит несинхрон. упражнение и его ex_outbox, если на него ссылается dirty-тренировка', () => {
    const workouts = [
      // dirty-тренировка юзера A ссылается на кастомное упражнение 'ex-custom'
      { id: 'w1', user_id: A, _dirty: 1, entries: [{ exercise_id: 'ex-custom', sets: [] }] },
    ]
    const exercises = [
      { id: 'ex-custom', name: 'Своё', _dirty: 1 }, // несинхрон. кастомное → переносим
      { id: 'ex-seed', name: 'Сидовое', _dirty: 0 }, // чистое, не упомянуто → нет
    ]
    const exOutbox = [
      { seq: 1, exerciseId: 'ex-custom' }, // ← переносим (FK-зависимость)
      { seq: 2, exerciseId: 'ex-other' },  // не упомянуто → нет
    ]
    const got = selectDirtyForMigration(workouts, [], A, { exercises, exOutbox })
    expect(got.exercises.map((e) => e.id)).toEqual(['ex-custom'])
    expect(got.exOutbox.map((o) => o.exerciseId)).toEqual(['ex-custom'])
  })

  it('НЕ переносит упражнение, если оно уже синхронизировано (_dirty=0)', () => {
    const workouts = [
      { id: 'w1', user_id: A, _dirty: 1, entries: [{ exercise_id: 'ex-seed', sets: [] }] },
    ]
    const exercises = [{ id: 'ex-seed', name: 'Сидовое', _dirty: 0 }]
    const got = selectDirtyForMigration(workouts, [], A, { exercises })
    expect(got.exercises).toEqual([]) // чистое упражнение доедет pull'ом
  })

  it('НЕ переносит упражнение, на которое ссылается только ЧУЖАЯ/чистая тренировка', () => {
    const workouts = [
      { id: 'w-clean', user_id: A, entries: [{ exercise_id: 'ex-custom' }] }, // чистая → не мигрируем
      { id: 'w-other', user_id: B, _dirty: 1, entries: [{ exercise_id: 'ex-custom' }] }, // чужая
    ]
    const exercises = [{ id: 'ex-custom', _dirty: 1 }]
    const exOutbox = [{ seq: 1, exerciseId: 'ex-custom' }]
    const got = selectDirtyForMigration(workouts, [], A, { exercises, exOutbox })
    expect(got.workouts).toEqual([])
    expect(got.exercises).toEqual([]) // упражнение не нужно — его тренировку не переносим
    expect(got.exOutbox).toEqual([])
  })
})
