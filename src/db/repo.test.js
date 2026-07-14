// Интеграционные тесты слоя записи (db/repo.js) на реальном Dexie поверх
// fake-indexeddb. Фокус — очередь outbox (схлопывание дублей), тумбстоны и
// сохранение/правка тренировок: самый рискованный по потере данных путь.
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import {
  saveWorkout, deleteWorkout, softDeleteMyWorkouts, getWorkout, getWorkouts,
  createExercise, updateExercise, getCustomExercises, getExercises, pendingCount, deadLetterCount,
  retryDeadLetter, discardDeadLetter, getLastSetsForExercise, toggleReaction,
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

describe('updateExercise', () => {
  it('меняет поля своего упражнения и ставит ре-upsert в ex_outbox', async () => {
    const ex = await createExercise({ name: 'Тяга блока', muscle_group: 'спина', metric: 'weight' })
    // очистим отметку create-op, чтобы проверить именно операцию правки
    await db.ex_outbox.clear()
    const res = await updateExercise({ id: ex.id, name: 'Тяга верхнего блока', muscle_group: 'спина', metric: 'weight' })
    expect(res.name).toBe('Тяга верхнего блока')
    const stored = await db.exercises.get(ex.id)
    expect(stored.name).toBe('Тяга верхнего блока')
    expect(stored._dirty).toBe(1)
    expect(await db.ex_outbox.where('exerciseId').equals(ex.id).count()).toBe(1)
  })

  it('смена типа метрики (weight → reps) сохраняется', async () => {
    const ex = await createExercise({ name: 'Планка', muscle_group: 'пресс', metric: 'weight' })
    await updateExercise({ id: ex.id, name: 'Планка', muscle_group: 'пресс', metric: 'time' })
    expect((await db.exercises.get(ex.id)).metric).toBe('time')
  })

  it('не плодит второй ре-upsert при повторной правке (одна операция на упражнение)', async () => {
    const ex = await createExercise({ name: 'Сгибания', muscle_group: 'бицепс' })
    await db.ex_outbox.clear()
    await updateExercise({ id: ex.id, name: 'Сгибания рук', muscle_group: 'бицепс' })
    await updateExercise({ id: ex.id, name: 'Сгибания рук стоя', muscle_group: 'бицепс' })
    expect(await db.ex_outbox.where('exerciseId').equals(ex.id).count()).toBe(1)
  })

  it('отклоняет правку не-своего (не is_custom) упражнения', async () => {
    await db.exercises.put({ id: 'ex_seed', name: 'Приседания', muscle_group: 'ноги', metric: 'weight', is_custom: false })
    await expect(
      updateExercise({ id: 'ex_seed', name: 'Присед', muscle_group: 'ноги', metric: 'weight' })
    ).rejects.toThrow()
  })

  it('отклоняет переименование в уже существующее (дубль) имя', async () => {
    const a = await createExercise({ name: 'Жим гантелей', muscle_group: 'грудь' })
    const b = await createExercise({ name: 'Разводка', muscle_group: 'грудь' })
    await expect(
      updateExercise({ id: b.id, name: '  жим  гантелей ', muscle_group: 'грудь' })
    ).rejects.toThrow()
    // само упражнение можно сохранить с тем же именем (себя не считаем дублем)
    await expect(
      updateExercise({ id: a.id, name: 'Жим гантелей', muscle_group: 'спина' })
    ).resolves.toBeTruthy()
  })

  it('getCustomExercises отдаёт только свои и без скрытых', async () => {
    const mine = await createExercise({ name: 'Своё-1', muscle_group: 'плечи' })
    await db.exercises.put({ id: 'ex_seed2', name: 'Сидовое', muscle_group: 'ноги', is_custom: false })
    const hidden = await createExercise({ name: 'Своё-скрытое', muscle_group: 'плечи' })
    await db.exercises.update(hidden.id, { is_hidden: true })
    const ids = (await getCustomExercises()).map((e) => e.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain('ex_seed2')
    expect(ids).not.toContain(hidden.id)
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

describe('getLastSetsForExercise (автоподстановка)', () => {
  it('отдаёт подходы последней тренировки по упражнению', async () => {
    await saveWorkout({ user_id: userId, performed_at: '2026-01-01',
      entries: [entry(bench, [{ weight: 80, reps: 8 }])] })
    await saveWorkout({ user_id: userId, performed_at: '2026-03-01',
      entries: [entry(bench, [{ weight: 100, reps: 5 }, { weight: 100, reps: 4 }])] })
    const sets = await getLastSetsForExercise(userId, 'ex_bench')
    expect(sets).toEqual([{ weight: 100, reps: 5 }, { weight: 100, reps: 4 }])
  })
  it('null, если упражнение ещё не делали', async () => {
    expect(await getLastSetsForExercise(userId, 'ex_bench')).toBe(null)
  })
})

describe('toggleReaction (очередь реакций + кэш ленты)', () => {
  // Кладём заготовку карточки ленты, чтобы проверить оптимистичную правку.
  async function seedFeed(workoutId, reactions = []) {
    await db.feed.put({ id: workoutId, performed_at: '2026-05-01', reactions })
  }

  it('add: ставит операцию и добавляет мою реакцию в кэш ленты', async () => {
    await seedFeed('w1')
    await toggleReaction({ userId, userName: 'Я', workoutId: 'w1', kind: 'fire', mine: false })
    const ops = await db.reaction_outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ workoutId: 'w1', kind: 'fire', op: 'add' })
    const item = await db.feed.get('w1')
    expect(item.reactions).toEqual([{ user_id: userId, name: 'Я', kind: 'fire' }])
  })

  it('add затем remove того же вида — взаимно отменяются (очередь пуста)', async () => {
    await seedFeed('w1')
    await toggleReaction({ userId, userName: 'Я', workoutId: 'w1', kind: 'fire', mine: false })
    await toggleReaction({ userId, userName: 'Я', workoutId: 'w1', kind: 'fire', mine: true })
    expect(await db.reaction_outbox.count()).toBe(0)
    const item = await db.feed.get('w1')
    expect(item.reactions).toEqual([]) // моя реакция снята из кэша
  })

  it('разные виды — независимые операции', async () => {
    await seedFeed('w1')
    await toggleReaction({ userId, userName: 'Я', workoutId: 'w1', kind: 'fire', mine: false })
    await toggleReaction({ userId, userName: 'Я', workoutId: 'w1', kind: 'muscle', mine: false })
    expect(await db.reaction_outbox.count()).toBe(2)
    const item = await db.feed.get('w1')
    expect(item.reactions.map((r) => r.kind).sort()).toEqual(['fire', 'muscle'])
  })

  it('remove по серверной реакции ставит одну операцию remove', async () => {
    await seedFeed('w1', [{ user_id: userId, name: 'Я', kind: 'clap' }])
    await toggleReaction({ userId, userName: 'Я', workoutId: 'w1', kind: 'clap', mine: true })
    const ops = await db.reaction_outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'clap', op: 'remove' })
    const item = await db.feed.get('w1')
    expect(item.reactions).toEqual([])
  })
})
