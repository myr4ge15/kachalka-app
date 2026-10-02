// Прямые интеграционные тесты стадии PUSH на реальном Dexie (fake-indexeddb)
// и замоканном Supabase. Проверяем контракты всех очередей и частичный commit:
// успешно отправленные данные не должны снова становиться dirty после сбоя ниже.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const server = vi.hoisted(() => ({
  calls: [],
  rpc: () => ({ data: null, error: null }),
  from: () => ({ data: null, error: null }),
}))

vi.mock('../supabase.js', () => {
  function resolve(builder) {
    server.calls.push({
      kind: 'from',
      table: builder.table,
      action: builder.action,
      payload: builder.payload,
      options: builder.options,
      filters: builder.filters,
    })
    return server.from(builder)
  }

  function from(table) {
    return {
      table,
      action: null,
      payload: null,
      options: null,
      filters: {},
      upsert(payload, options) {
        this.action = 'upsert'
        this.payload = payload
        this.options = options
        return this
      },
      delete() {
        this.action = 'delete'
        return this
      },
      eq(key, value) {
        this.filters[key] = value
        return this
      },
      match(filters) {
        Object.assign(this.filters, filters)
        return this
      },
      then(resolvePromise, rejectPromise) {
        return Promise.resolve(resolve(this)).then(resolvePromise, rejectPromise)
      },
    }
  }

  function rpc(name, args) {
    server.calls.push({ kind: 'rpc', name, args })
    return {
      then(resolvePromise, rejectPromise) {
        return Promise.resolve(server.rpc(name, args)).then(resolvePromise, rejectPromise)
      },
    }
  }

  return { supabase: { from, rpc } }
})

import { openUserDb, closeUserDb, db, setMeta } from '../local.js'
import { readGoals, writeGoals } from '../notifications.js'
import {
  getUserMetaState,
  readSyncedMeta,
  writeSyncedMeta,
} from '../userMeta.js'
import {
  push,
  pushExercises,
  pushGoal,
  pushReactions,
  pushTemplates,
  pushUserMeta,
} from './push.js'
import { uniqueUserId } from '../../test/idbHarness.js'

let userId

beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  server.calls.length = 0
  server.rpc = () => ({ data: null, error: null })
  server.from = () => ({ data: null, error: null })
})

afterEach(async () => {
  await closeUserDb()
})

describe('pushExercises', () => {
  it('отправляет полный снимок упражнения и очищает очередь только после успеха', async () => {
    await db.exercises.put({
      id: 'ex1',
      name: 'Тяга блока',
      muscle_group: 'спина',
      submuscle: 'широчайшие',
      secondary: ['бицепс'],
      is_bench_lift: 0,
      metric: 'reps',
      owner_id: userId,
      _dirty: 1,
    })
    await db.ex_outbox.add({ exerciseId: 'ex1', createdAt: '2026-07-29T10:00:00.000Z' })

    await pushExercises(db)

    expect(server.calls[0]).toMatchObject({
      kind: 'from',
      table: 'exercises',
      action: 'upsert',
      payload: {
        id: 'ex1',
        name: 'Тяга блока',
        muscle_group: 'спина',
        submuscle: 'широчайшие',
        secondary: ['бицепс'],
        is_custom: true,
        is_bench_lift: false,
        metric: 'reps',
        owner_id: userId,
      },
      options: { onConflict: 'id' },
    })
    expect((await db.exercises.get('ex1'))._dirty).toBe(0)
    expect(await db.ex_outbox.count()).toBe(0)
  })
})

describe('pushTemplates', () => {
  it('сохраняет порядок целей шаблона и обрабатывает delete вслед за upsert', async () => {
    await db.templates.bulkPut([
      {
        id: 'tpl-up',
        user_id: userId,
        name: 'Спина',
        is_public: 1,
        exercises: [
          { exercise_id: 'ex2', position: 1, sets: 2, reps: 12, weight: 30 },
          { exercise_id: 'ex1', position: 0, sets: 3, reps: 8, weight: 50 },
        ],
        _dirty: 1,
        _deleted: 0,
      },
      {
        id: 'tpl-del',
        user_id: userId,
        name: 'Удаленный',
        exercises: [],
        _dirty: 0,
        _deleted: 1,
      },
    ])
    await db.tpl_outbox.bulkAdd([
      { templateId: 'tpl-up', type: 'upsert', createdAt: '2026-07-29T10:00:00.000Z' },
      { templateId: 'tpl-del', type: 'delete', createdAt: '2026-07-29T10:01:00.000Z' },
    ])

    await pushTemplates(db)

    const upsert = server.calls.find((call) => call.name === 'upsert_template')
    expect(upsert.args).toMatchObject({
      p_template_id: 'tpl-up',
      p_user_id: userId,
      p_name: 'Спина',
      p_is_public: true,
      p_exercise_ids: [
        { id: 'ex1', sets: 3, reps: 8, weight: 50 },
        { id: 'ex2', sets: 2, reps: 12, weight: 30 },
      ],
    })
    expect(server.calls.find((call) => call.table === 'workout_templates')).toMatchObject({
      action: 'delete',
      filters: { id: 'tpl-del' },
    })
    expect((await db.templates.get('tpl-up'))._dirty).toBe(0)
    expect(await db.templates.get('tpl-del')).toBeUndefined()
    expect(await db.tpl_outbox.count()).toBe(0)
  })
})

describe('push тренировок и реакций', () => {
  it('нормализует подходы, возвращает justPushed и удаляет серверный tombstone', async () => {
    await db.workouts.bulkPut([
      {
        id: 'w-up',
        user_id: userId,
        performed_at: '2026-07-28',
        updated_at: '2026-07-28T20:00:00.000Z',
        _base_updated_at: '2026-07-27T20:00:00.000Z',
        _dirty: 1,
        _deleted: 0,
        entries: [{ exercise_id: 'ex1', sets: [{ weight: '80', reps: '6' }] }],
      },
      {
        id: 'w-del',
        user_id: userId,
        performed_at: '2026-07-27',
        _dirty: 0,
        _deleted: 1,
        entries: [],
      },
    ])
    await db.outbox.bulkAdd([
      { workoutId: 'w-up', type: 'upsert', createdAt: '2026-07-29T10:00:00.000Z' },
      { workoutId: 'w-del', type: 'delete', createdAt: '2026-07-29T10:01:00.000Z' },
    ])

    const justPushed = await push(db)

    expect([...justPushed]).toEqual(['w-up'])
    expect(server.calls.find((call) => call.name === 'upsert_workout').args).toMatchObject({
      p_workout_id: 'w-up',
      p_user_id: userId,
      p_performed_at: '2026-07-28',
      p_entries: [{ exercise_id: 'ex1', sets: [{ weight: 80, reps: 6 }] }],
    })
    expect(server.calls.find((call) => call.table === 'workouts')).toMatchObject({
      action: 'delete',
      filters: { id: 'w-del' },
    })
    expect(await db.outbox.count()).toBe(0)
    expect(await db.workouts.get('w-del')).toBeUndefined()
    expect(await db.workouts.get('w-up')).toMatchObject({
      _dirty: 0,
      _base_updated_at: null,
    })
  })

  it('отправляет add/remove реакции с идентичностью текущего пользователя', async () => {
    await db.reaction_outbox.bulkAdd([
      { workoutId: 'w1', kind: 'fire', op: 'add', createdAt: '2026-07-29T10:00:00.000Z' },
      { workoutId: 'w2', kind: 'strong', op: 'remove', createdAt: '2026-07-29T10:01:00.000Z' },
    ])

    await pushReactions(userId, db)

    expect(server.calls[0]).toMatchObject({
      table: 'reactions',
      action: 'upsert',
      payload: { user_id: userId, workout_id: 'w1', kind: 'fire' },
      options: {
        onConflict: 'user_id,workout_id,kind',
        ignoreDuplicates: true,
      },
    })
    expect(server.calls[1]).toMatchObject({
      table: 'reactions',
      action: 'delete',
      filters: { user_id: userId, workout_id: 'w2', kind: 'strong' },
    })
    expect(await db.reaction_outbox.count()).toBe(0)
  })
})

// Правка, сделанная ПОКА ШЕЛ сетевой upsert: repo видит еще живую операцию и новую
// не ставит. Push не должен снимать _dirty и удалять операцию — иначе pull того же
// цикла перезапишет правку серверной версией.
describe('push — правка во время отправки не теряется', () => {
  it('тренировка: остается dirty с операцией, базис обнулен', async () => {
    await db.workouts.put({
      id: 'w1', user_id: userId, performed_at: '2026-07-28',
      updated_at: '2026-07-28T20:00:00.000Z', _base_updated_at: '2026-07-27T20:00:00.000Z',
      _dirty: 1, _deleted: 0,
      entries: [{ exercise_id: 'ex1', sets: [{ weight: 80, reps: 6 }] }],
    })
    await db.outbox.add({ workoutId: 'w1', type: 'upsert', createdAt: '2026-07-29T10:00:00.000Z' })
    server.rpc = async () => {
      await db.workouts.update('w1', {
        updated_at: '2026-07-28T20:05:00.000Z',
        entries: [{ exercise_id: 'ex1', sets: [{ weight: 85, reps: 5 }] }],
      })
      return { data: null, error: null }
    }

    const justPushed = await push(db)

    expect([...justPushed]).toEqual(['w1'])
    expect(await db.workouts.get('w1')).toMatchObject({ _dirty: 1, _base_updated_at: null })
    expect(await db.outbox.count()).toBe(1)
  })

  it('тренировка без правки в полете — как раньше: чистая, очередь пуста', async () => {
    await db.workouts.put({
      id: 'w1', user_id: userId, performed_at: '2026-07-28',
      updated_at: '2026-07-28T20:00:00.000Z', _dirty: 1, _deleted: 0,
      entries: [{ exercise_id: 'ex1', sets: [{ weight: 80, reps: 6 }] }],
    })
    await db.outbox.add({ workoutId: 'w1', type: 'upsert', createdAt: '2026-07-29T10:00:00.000Z' })

    await push(db)

    expect((await db.workouts.get('w1'))._dirty).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('упражнение: правка названия во время upsert остается в очереди', async () => {
    await db.exercises.put({ id: 'ex1', name: 'Тяга', muscle_group: 'спина', owner_id: userId, _dirty: 1 })
    await db.ex_outbox.add({ exerciseId: 'ex1', createdAt: '2026-07-29T10:00:00.000Z' })
    server.from = async () => {
      await db.exercises.update('ex1', { name: 'Тяга блока' })
      return { data: null, error: null }
    }

    await pushExercises(db)

    expect(await db.exercises.get('ex1')).toMatchObject({ name: 'Тяга блока', _dirty: 1 })
    expect(await db.ex_outbox.count()).toBe(1)
  })

  it('шаблон: правка во время upsert остается в очереди', async () => {
    await db.templates.put({
      id: 't1', user_id: userId, name: 'Спина', is_public: 0,
      updated_at: '2026-07-29T10:00:00.000Z', exercises: [], _dirty: 1, _deleted: 0,
    })
    await db.tpl_outbox.add({ templateId: 't1', type: 'upsert', createdAt: '2026-07-29T10:00:00.000Z' })
    server.rpc = async () => {
      await db.templates.update('t1', { name: 'Спина 2', updated_at: '2026-07-29T10:01:00.000Z' })
      return { data: null, error: null }
    }

    await pushTemplates(db)

    expect(await db.templates.get('t1')).toMatchObject({ name: 'Спина 2', _dirty: 1 })
    expect(await db.tpl_outbox.count()).toBe(1)
  })
})

describe('pushGoal / pushUserMeta — правки во время отправки', () => {
  const goalA = { exerciseId: 'exA', exerciseName: 'Жим', metric: 'weight', targetWeight: 100, achievedAt: null, _dirty: 1 }

  it('цель, добавленная пока шел upsert другой, не стирается', async () => {
    await writeGoals(userId, [goalA], db)
    server.rpc = async (name) => {
      if (name === 'upsert_goal') {
        const cur = await readGoals(userId, db)
        await writeGoals(userId, [...cur, { ...goalA, exerciseId: 'exB', exerciseName: 'Присед', targetWeight: 140 }], db)
      }
      return { data: null, error: null }
    }

    await pushGoal(userId, db)

    const goals = await readGoals(userId, db)
    expect(goals.map((g) => g.exerciseId)).toEqual(['exA', 'exB'])
    expect(goals[0]._dirty).toBe(0)
    expect(goals[1]._dirty).toBe(1)
  })

  it('цель, измененная во время своего upsert, остается dirty', async () => {
    await writeGoals(userId, [goalA], db)
    server.rpc = async (name) => {
      if (name === 'upsert_goal') await writeGoals(userId, [{ ...goalA, targetWeight: 105 }], db)
      return { data: null, error: null }
    }

    await pushGoal(userId, db)

    expect((await readGoals(userId, db))[0]).toMatchObject({ targetWeight: 105, _dirty: 1 })
  })

  it('цель, заведенная заново во время delete, не выкидывается', async () => {
    await writeGoals(userId, [{ ...goalA, _deleted: 1 }], db)
    server.rpc = async (name) => {
      if (name === 'delete_my_goal') await writeGoals(userId, [{ ...goalA, targetWeight: 90 }], db)
      return { data: null, error: null }
    }

    await pushGoal(userId, db)

    expect(await readGoals(userId, db)).toEqual([{ ...goalA, targetWeight: 90 }])
  })

  it('ключ user_meta, измененный во время отправки, остается dirty', async () => {
    await writeSyncedMeta(userId, 'prog', { enabled: true, byExercise: {} }, db)
    server.rpc = async (name) => {
      if (name === 'upsert_user_meta') {
        // отметка времени правки обязана сдвинуться — ждем смены миллисекунды
        await new Promise((r) => setTimeout(r, 5))
        await writeSyncedMeta(userId, 'prog', { enabled: false, byExercise: {} }, db)
      }
      return { data: '2026-07-29T12:00:00.000Z', error: null }
    }

    await pushUserMeta(userId, db)

    expect((await getUserMetaState(db)).prog.dirty).toBe(1)
    expect(await readSyncedMeta(userId, 'prog', db)).toEqual({ enabled: false, byExercise: {} })
  })
})

describe('pushGoal / pushUserMeta — частичный commit', () => {
  it('после сбоя второй цели не возвращает первую успешно отправленную в dirty', async () => {
    await writeGoals(userId, [
      {
        exerciseId: 'ex1',
        exerciseName: 'Жим',
        metric: 'weight',
        targetWeight: 100,
        targetReps: 5,
        achievedAt: null,
        _dirty: 1,
      },
      {
        exerciseId: 'ex2',
        exerciseName: 'Подтягивания',
        metric: 'reps',
        targetWeight: 15,
        achievedAt: null,
        _dirty: 1,
      },
    ], db)
    server.rpc = (name, args) => {
      if (name !== 'upsert_goal') return { data: null, error: null }
      if (args.p_exercise_id === 'ex1') {
        return { data: { achieved_at: '2026-07-29T11:00:00.000Z' }, error: null }
      }
      return { data: null, error: { message: 'second failed' } }
    }

    await expect(pushGoal(userId, db)).rejects.toMatchObject({ message: 'second failed' })

    const goals = await readGoals(userId, db)
    expect(goals[0]).toMatchObject({
      exerciseId: 'ex1',
      _dirty: 0,
      achievedAt: '2026-07-29T11:00:00.000Z',
    })
    expect(goals[1]).toMatchObject({ exerciseId: 'ex2', _dirty: 1 })
  })

  it('фиксирует первый ключ user_meta до ошибки следующего', async () => {
    await writeSyncedMeta(userId, 'badges', { first: { at: '2026-07-01' } }, db)
    await writeSyncedMeta(userId, 'prog', { ex1: { strategy: 'weight' } }, db)
    server.rpc = (name, args) => {
      if (name !== 'upsert_user_meta') return { data: null, error: null }
      if (args.p_key === 'badges') {
        return { data: '2026-07-29T12:00:00.000Z', error: null }
      }
      return { data: null, error: { message: 'meta failed' } }
    }

    await expect(pushUserMeta(userId, db)).rejects.toMatchObject({ message: 'meta failed' })

    const state = await getUserMetaState(db)
    expect(state.badges).toEqual({ at: '2026-07-29T12:00:00.000Z', dirty: 0, base: '2026-07-29T12:00:00.000Z' })
    expect(state.prog.dirty).toBe(1)
    expect(await readSyncedMeta(userId, 'badges', db)).toEqual({
      first: { at: '2026-07-01' },
    })
  })

  it('снимает dirty у отсутствующего локального значения без сетевого запроса', async () => {
    await setMeta('user_meta_state', {
      badges: { at: '2026-07-29T10:00:00.000Z', dirty: 1 },
    }, db)

    await pushUserMeta(userId, db)

    expect(server.calls).toEqual([])
    expect((await getUserMetaState(db)).badges.dirty).toBe(0)
  })
})
