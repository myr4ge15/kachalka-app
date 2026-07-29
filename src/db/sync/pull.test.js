// Прямые интеграционные тесты стадии PULL на реальном Dexie (fake-indexeddb)
// и замоканном Supabase. Проверяем границу критичности подтяжек, fallback целей
// и слияние user_meta — пути, которые не покрывает оркестратор syncNow.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const server = vi.hoisted(() => ({
  calls: [],
  from: () => ({ data: [], error: null }),
  rpc: () => ({ data: false, error: null }),
}))

vi.mock('../supabase.js', () => {
  function resolve(builder) {
    const call = {
      table: builder.table,
      select: builder.selection,
      filters: { ...builder.filters },
      gt: builder.gtFilter,
      or: builder.orFilter,
    }
    server.calls.push(call)
    return server.from(call)
  }

  function from(table) {
    return {
      table,
      selection: '',
      filters: {},
      gtFilter: null,
      orFilter: null,
      select(selection) {
        this.selection = selection
        return this
      },
      eq(key, value) {
        this.filters[key] = value
        return this
      },
      gt(key, value) {
        this.gtFilter = { key, value }
        return this
      },
      order() {
        return this
      },
      limit() {
        return this
      },
      or(value) {
        this.orFilter = value
        return this
      },
      then(resolvePromise, rejectPromise) {
        return Promise.resolve(resolve(this)).then(resolvePromise, rejectPromise)
      },
    }
  }

  function rpc(name, args) {
    server.calls.push({ rpc: name, args })
    return {
      then(resolvePromise, rejectPromise) {
        return Promise.resolve(server.rpc(name, args)).then(resolvePromise, rejectPromise)
      },
    }
  }

  return { supabase: { from, rpc } }
})

import { openUserDb, closeUserDb, db, getMeta, setMeta } from '../local.js'
import { readGoals, writeGoals } from '../notifications.js'
import {
  getUserMetaState,
  setUserMetaState,
} from '../userMeta.js'
import { pull, pullGoal, pullUserMeta } from './pull.js'
import { uniqueUserId } from '../../test/idbHarness.js'

const T1 = '2026-07-01T10:00:00.000Z'
const T2 = '2026-07-20T10:00:00.000Z'
const T3 = '2026-07-29T10:00:00.000Z'

function workoutRow(id, userId) {
  return {
    id,
    user_id: userId,
    performed_at: '2026-07-28',
    created_at: T2,
    updated_at: T3,
    workout_exercises: [{
      id: `we-${id}`,
      position: 0,
      exercise_id: 'ex1',
      exercise: {
        id: 'ex1',
        name: 'Жим лёжа',
        muscle_group: 'грудь',
        metric: 'weight',
      },
      sets: [{ id: `set-${id}`, set_number: 0, weight: 100, reps: 5 }],
    }],
  }
}

function defaultResponse(call) {
  if (call.table === 'exercises' && call.select === 'updated_at') {
    return { data: [], error: null }
  }
  if (call.table === 'login_users' && call.select === 'id, updated_at') {
    return { data: [], error: null }
  }
  if (call.table === 'workouts' && call.select === 'id') {
    return { data: [], error: null }
  }
  if (call.table === 'workout_templates' && call.select === 'id, updated_at') {
    return { data: [], error: null }
  }
  return { data: [], error: null }
}

let userId

beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  server.calls.length = 0
  server.from = defaultResponse
  server.rpc = () => ({ data: false, error: null })
})

afterEach(async () => {
  await closeUserDb()
})

describe('pull — граница критичности', () => {
  it('мягко деградирует при сбое справочника, но принимает тренировки', async () => {
    server.from = (call) => {
      if (call.table === 'exercises' && call.select !== 'updated_at') {
        return { data: null, error: { message: 'exercises unavailable' } }
      }
      if (call.table === 'workouts' && call.select === 'id') {
        return { data: [{ id: 'w1' }], error: null }
      }
      if (call.table === 'workouts') {
        return { data: [workoutRow('w1', userId)], error: null }
      }
      // Ошибка пробы справочника включает fallback на полный refetch.
      if (call.table === 'exercises') {
        return { data: null, error: { message: 'probe unavailable' } }
      }
      return defaultResponse(call)
    }

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toContain('упражнения: exercises unavailable')
    expect(await db.workouts.get('w1')).toMatchObject({
      id: 'w1',
      user_id: userId,
      _dirty: 0,
      _deleted: 0,
    })
  })

  it('пробрасывает ошибку основной выборки тренировок', async () => {
    server.from = (call) => {
      if (call.table === 'workouts' && call.select !== 'id') {
        return { data: null, error: { message: 'workouts unavailable' } }
      }
      return defaultResponse(call)
    }

    await expect(pull(userId, new Set(), db)).rejects.toMatchObject({
      message: 'workouts unavailable',
    })
  })
})

describe('pullGoal', () => {
  it('не читает сервер, пока есть локальная dirty-цель', async () => {
    await writeGoals(userId, [{
      exerciseId: 'ex1',
      exerciseName: 'Жим',
      metric: 'weight',
      targetWeight: 100,
      achievedAt: null,
      _dirty: 1,
    }], db)

    await pullGoal(userId, db)

    expect(server.calls.filter((call) => call.table === 'goals')).toEqual([])
    expect((await readGoals(userId, db))[0]._dirty).toBe(1)
  })

  it('откатывается на legacy-select и не стирает локальное достижение reps-цели', async () => {
    await db.exercises.put({ id: 'ex1', name: 'Подтягивания', metric: 'reps' })
    await writeGoals(userId, [{
      exerciseId: 'ex1',
      exerciseName: 'Старое имя',
      metric: 'reps',
      targetWeight: 15,
      achievedAt: T2,
      _dirty: 0,
    }], db)
    server.from = (call) => {
      if (call.table !== 'goals') return defaultResponse(call)
      if (call.select.includes('metric')) {
        return { data: null, error: { message: 'metric column is missing' } }
      }
      return {
        data: [{ exercise_id: 'ex1', target_weight: 15, achieved_at: null }],
        error: null,
      }
    }

    await pullGoal(userId, db)

    expect(server.calls.filter((call) => call.table === 'goals')).toHaveLength(2)
    expect((await readGoals(userId, db))[0]).toMatchObject({
      exerciseId: 'ex1',
      exerciseName: 'Подтягивания',
      metric: 'reps',
      targetWeight: 15,
      achievedAt: T2,
      _dirty: 0,
    })
  })
})

describe('pullUserMeta', () => {
  it('объединяет бейджи и принимает более свежие настройки прогрессии', async () => {
    await setMeta(`badges_${userId}`, {
      local: { at: T1, backfilled: false },
    }, db)
    await setMeta(`prog_${userId}`, { ex1: { strategy: 'reps' } }, db)
    await setUserMetaState('badges', { at: T2, dirty: 0 }, db)
    await setUserMetaState('prog', { at: T1, dirty: 0 }, db)
    server.from = (call) => {
      if (call.table !== 'user_meta') return defaultResponse(call)
      return {
        data: [
          {
            key: 'badges',
            value: { remote: { at: T2, backfilled: true } },
            updated_at: T3,
          },
          {
            key: 'prog',
            value: { ex1: { strategy: 'weight' } },
            updated_at: T3,
          },
        ],
        error: null,
      }
    }

    await pullUserMeta(userId, db)

    expect(await getMeta(`badges_${userId}`, db)).toEqual({
      local: { at: T1, backfilled: false },
      remote: { at: T2, backfilled: true },
    })
    expect(await getMeta(`prog_${userId}`, db)).toEqual({
      ex1: { strategy: 'weight' },
    })
    const state = await getUserMetaState(db)
    expect(state.badges.dirty).toBe(1)
    expect(state.prog).toEqual({ at: T3, dirty: 0 })
  })
})
