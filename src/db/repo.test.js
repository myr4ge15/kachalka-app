// Интеграционные тесты слоя записи (db/repo.js) на реальном Dexie поверх
// fake-indexeddb. Фокус — очередь outbox (схлопывание дублей), тумбстоны и
// сохранение/правка тренировок: самый рискованный по потере данных путь.
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import {
  saveWorkout, deleteWorkout, softDeleteMyWorkouts, getWorkout, getWorkouts,
  createExercise, getExercises, pendingCount, deadLetterCount,
  retryDeadLetter, discardDeadLetter,
} from './repo.js'

// Упражнение-заготовка (весовое).
const bench = { id: 'ex_bench', name: 'Жим лёжа', muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' }
const entry = (ex, sets) => ({ exercise: ex, sets })

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
})
afterEach(async () => {
  await closeUserDb()
})

describe('saveWorkout / outbox', () => {
  it('создание: пишет документ _dirty=1 и ставит один upsert в очередь', async () => {
    const id = await saveWorkout({
      user_id: userId,
      performed_at: '2026-01-10T10:00:00.000Z',
      entries: [entry(bench, [{ weight: 100, reps: 5 }])],
    })
    const doc = await db.workouts.get(id)
    expect(doc._dirty).toBe(1)
    expect(doc._deleted).toBe(0)
    expect(doc._base_updated_at).toBe(null) // новая запись — базиса нет
    expect(doc.entries[0].sets).toEqual([{ weight: 100, reps: 5 }])
    const ops = await db.outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ workoutId: id, type: 'upsert' })
  })

  it('клампит абсурдный ввод при сохранении (вес<0 → 0)', async () => {
    const id = await saveWorkout({
      user_id: userId,
      performed_at: '2026-01-10',
      entries: [entry(bench, [{ weight: -50, reps: 3 }])],
    })
    const doc = await db.workouts.get(id)
    expect(doc.entries[0].sets[0].weight).toBe(0)
  })

  it('правка: сохраняет created_at, обновляет updated_at, НЕ плодит второй upsert', async () => {
    const id = await saveWorkout({
      user_id: userId, performed_at: '2026-01-10',
      entries: [entry(bench, [{ weight: 100, reps: 5 }])],
    })
    const created = (await db.workouts.get(id)).created_at
    await saveWorkout({
      id, user_id: userId, performed_at: '2026-01-10',
      entries: [entry(bench, [{ weight: 105, reps: 5 }])],
    })
    const doc = await db.workouts.get(id)
    expect(doc.created_at).toBe(created)
    expect(doc.entries[0].sets[0].weight).toBe(105)
    // upsert-поверх-upsert схлопнут в одну операцию
    expect(await db.outbox.where('workoutId').equals(id).count()).toBe(1)
  })

  it('пустая тренировка (все подходы отсеяны) — бросает', async () => {
    await expect(saveWorkout({
      user_id: userId, performed_at: '2026-01-10',
      entries: [entry(bench, [{ weight: 100, reps: 0 }])], // reps 0 → подход отсеян
    })).rejects.toThrow()
  })
})

describe('очередь: схлопывание дублей', () => {
  it('delete отменяет ожидающий upsert (новая запись убрана из очереди)', async () => {
    const id = await saveWorkout({
      user_id: userId, performed_at: '2026-01-10',
      entries: [entry(bench, [{ weight: 100, reps: 5 }])],
    })
    expect(await db.outbox.where('workoutId').equals(id).count()).toBe(1)
    await deleteWorkout(id)
    const ops = await db.outbox.where('workoutId').equals(id).toArray()
    // upsert снят, остаётся ровно один delete
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe('delete')
  })

  it('upsert после delete (пересоздание) заменяет delete на upsert', async () => {
    const id = 'w_recreate'
    await saveWorkout({ id, user_id: userId, performed_at: '2026-01-10', entries: [entry(bench, [{ weight: 90, reps: 5 }])] })
    await deleteWorkout(id)
    await saveWorkout({ id, user_id: userId, performed_at: '2026-01-10', entries: [entry(bench, [{ weight: 92, reps: 5 }])] })
    const ops = await db.outbox.where('workoutId').equals(id).toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe('upsert')
  })
})

describe('deleteWorkout / тумбстон', () => {
  it('помечает _deleted=1, _dirty=0 и ставит delete в очередь', async () => {
    const id = await saveWorkout({
      user_id: userId, performed_at: '2026-01-10',
      entries: [entry(bench, [{ weight: 100, reps: 5 }])],
    })
    await deleteWorkout(id)
    const doc = await db.workouts.get(id)
    expect(doc._deleted).toBe(1)
    expect(doc._dirty).toBe(0)
    expect(await getWorkout(id)).toBe(null) // из UI не виден
  })

  it('getWorkouts не показывает удалённые', async () => {
    const a = await saveWorkout({ user_id: userId, performed_at: '2026-01-11', entries: [entry(bench, [{ weight: 100, reps: 5 }])] })
    await saveWorkout({ user_id: userId, performed_at: '2026-01-12', entries: [entry(bench, [{ weight: 101, reps: 5 }])] })
    await deleteWorkout(a)
    const list = await getWorkouts(userId)
    expect(list).toHaveLength(1)
    expect(list.every((w) => w.id !== a)).toBe(true)
  })

  it('getWorkouts сортирует по дате тренировки (свежие сверху)', async () => {
    await saveWorkout({ user_id: userId, performed_at: '2026-01-05', entries: [entry(bench, [{ weight: 1, reps: 5 }])] })
    await saveWorkout({ user_id: userId, performed_at: '2026-01-20', entries: [entry(bench, [{ weight: 2, reps: 5 }])] })
    await saveWorkout({ user_id: userId, performed_at: '2026-01-12', entries: [entry(bench, [{ weight: 3, reps: 5 }])] })
    const dates = (await getWorkouts(userId)).map((w) => w.performed_at)
    expect(dates).toEqual(['2026-01-20', '2026-01-12', '2026-01-05'])
  })
})

describe('softDeleteMyWorkouts', () => {
  it('помечает все свои тренировки и ставит по delete на каждую; идемпотентно', async () => {
    await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [entry(bench, [{ weight: 100, reps: 5 }])] })
    await saveWorkout({ user_id: userId, performed_at: '2026-01-11', entries: [entry(bench, [{ weight: 101, reps: 5 }])] })
    const n = await softDeleteMyWorkouts(userId)
    expect(n).toBe(2)
    expect(await getWorkouts(userId)).toHaveLength(0)
    // повторный вызов уже помеченные не трогает
    expect(await softDeleteMyWorkouts(userId)).toBe(0)
  })
})

describe('createExercise', () => {
  it('создаёт _dirty упражнение и ставит его в ex_outbox', async () => {
    const ex = await createExercise({ name: 'Присед', muscle_group: 'ноги', metric: 'weight' })
    expect(ex.id).toBeTruthy()
    const stored = await db.exercises.get(ex.id)
    expect(stored._dirty).toBe(1)
    expect(await db.ex_outbox.where('exerciseId').equals(ex.id).count()).toBe(1)
  })

  it('анти-дубль: то же имя (регистр/пробелы) не плодит копию', async () => {
    const a = await createExercise({ name: 'Тяга', muscle_group: 'спина' })
    const b = await createExercise({ name: '  тяга ', muscle_group: 'спина' })
    expect(b.id).toBe(a.id)
    expect(await db.exercises.where('name').equals('Тяга').count()).toBe(1)
  })

  it('скрытые (is_hidden) не попадают в пикер getExercises', async () => {
    const ex = await createExercise({ name: 'Скрытое', muscle_group: 'прочее' })
    await db.exercises.update(ex.id, { is_hidden: true })
    const ids = (await getExercises()).map((e) => e.id)
    expect(ids).not.toContain(ex.id)
  })
})

describe('dead-letter: pendingCount / retry / discard', () => {
  it('pendingCount считает живые операции, _dead — нет', async () => {
    const id = await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [entry(bench, [{ weight: 100, reps: 5 }])] })
    expect(await pendingCount()).toBe(1)
    // помечаем операцию мёртвой вручную
    const op = await db.outbox.where('workoutId').equals(id).first()
    await db.outbox.update(op.seq, { _dead: 1 })
    expect(await pendingCount()).toBe(0)
    expect(await deadLetterCount()).toBe(1)
  })

  it('retryDeadLetter воскрешает: снимает _dead и обнуляет attempts', async () => {
    const id = await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [entry(bench, [{ weight: 100, reps: 5 }])] })
    const op = await db.outbox.where('workoutId').equals(id).first()
    await db.outbox.update(op.seq, { _dead: 1, attempts: 5 })
    const n = await retryDeadLetter()
    expect(n).toBe(1)
    const after = await db.outbox.get(op.seq)
    expect(after._dead).toBe(0)
    expect(after.attempts).toBe(0)
    expect(await deadLetterCount()).toBe(0)
  })

  it('discardDeadLetter удаляет операцию и снимает _dirty/_deleted с документа', async () => {
    const id = await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [entry(bench, [{ weight: 100, reps: 5 }])] })
    const op = await db.outbox.where('workoutId').equals(id).first()
    await db.outbox.update(op.seq, { _dead: 1 })
    const n = await discardDeadLetter()
    expect(n).toBe(1)
    expect(await db.outbox.count()).toBe(0)
    const doc = await db.workouts.get(id)
    expect(doc._dirty).toBe(0)
    expect(doc._deleted).toBe(0)
  })
})
