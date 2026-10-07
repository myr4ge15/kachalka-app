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

import { openUserDb, closeUserDb, db, loginDb, getMeta, setMeta, getLoginMeta, setLoginMeta } from '../local.js'
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
        name: 'Жим лежа',
        muscle_group: 'грудь',
        metric: 'weight',
      },
      sets: [{ id: `set-${id}`, set_number: 0, weight: 100, reps: 5 }],
    }],
  }
}

function defaultResponse(call) {
  if (call.table === 'exercises' && call.select === 'id, updated_at') {
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
      if (call.table === 'exercises' && call.select !== 'id, updated_at') {
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

  it('не затирает цель, сохраненную пока шел запрос к серверу', async () => {
    const fresh = { exerciseId: 'ex2', exerciseName: 'Присед', metric: 'weight', targetWeight: 140, achievedAt: null, _dirty: 1 }
    server.from = async (call) => {
      if (call.table !== 'goals') return defaultResponse(call)
      // человек сохранил новую цель, пока ответ был в пути
      await writeGoals(userId, [fresh], db)
      // на сервере — другой список (без новой цели): его запись стерла бы ее
      return { data: [{ exercise_id: 'ex1', target_weight: 100, metric: 'weight', achieved_at: null }], error: null }
    }

    await pullGoal(userId, db)

    expect(await readGoals(userId, db)).toEqual([fresh])
  })

  it('без правок во время запроса принимает серверный список', async () => {
    server.from = (call) => {
      if (call.table !== 'goals') return defaultResponse(call)
      return { data: [{ exercise_id: 'ex1', target_weight: 100, metric: 'weight', achieved_at: null }], error: null }
    }

    await pullGoal(userId, db)

    expect(await readGoals(userId, db)).toMatchObject([{ exerciseId: 'ex1', targetWeight: 100, _dirty: 0 }])
  })
})

describe('pull справочника упражнений', () => {
  function exercisesServer(rows) {
    return (call) => {
      if (call.table === 'exercises' && call.select === 'id, updated_at') {
        return { data: rows.map((e) => ({ id: e.id, updated_at: e.updated_at })), error: null }
      }
      if (call.table === 'exercises') return { data: rows, error: null }
      return defaultResponse(call)
    }
  }
  const exFullFetches = () =>
    server.calls.filter((c) => c.table === 'exercises' && c.select !== 'id, updated_at').length

  // П3 «Мой круг» (v6.16.4): справочник зависит от видимости владельца личных упражнений.
  it('стал виден сосед: его СТАРОЕ упражнение (updated_at ниже метки) подтягивается', async () => {
    const own = { id: 'ex1', name: 'Жим', updated_at: T3 }
    server.from = exercisesServer([own])
    await pull(userId, new Set(), db)
    server.calls.length = 0

    server.from = exercisesServer([own, { id: 'nb', name: 'Сосед: тяга', updated_at: T1 }])
    await pull(userId, new Set(), db)

    expect(exFullFetches()).toBe(1)
    expect((await db.exercises.get('nb')).name).toBe('Сосед: тяга')
  })

  it('сосед перестал быть виден: его упражнение уходит из справочника', async () => {
    const own = { id: 'ex1', name: 'Жим', updated_at: T1 }
    server.from = exercisesServer([own, { id: 'nb', name: 'Сосед: тяга', updated_at: T3 }])
    await pull(userId, new Set(), db)
    expect(await db.exercises.get('nb')).toBeTruthy()

    server.from = exercisesServer([own])
    await pull(userId, new Set(), db)

    expect(await db.exercises.get('nb')).toBeUndefined()
    expect(await db.exercises.get('ex1')).toBeTruthy()
  })

  it('набор и время те же → полной выборки нет', async () => {
    server.from = exercisesServer([{ id: 'ex1', name: 'Жим', updated_at: T1 }])
    await pull(userId, new Set(), db)
    server.calls.length = 0
    await pull(userId, new Set(), db)
    expect(exFullFetches()).toBe(0)
  })

  it('правка известного серверу упражнения с живой операцией не затирается', async () => {
    await db.exercises.put({ id: 'ex1', name: 'Тяга блока', _dirty: 1 })
    await db.ex_outbox.add({ exerciseId: 'ex1', createdAt: T3 })
    server.from = exercisesServer([{ id: 'ex1', name: 'Тяга', updated_at: T2 }])

    await pull(userId, new Set(), db)

    expect(await db.exercises.get('ex1')).toMatchObject({ name: 'Тяга блока', _dirty: 1 })
    expect(await db.ex_outbox.count()).toBe(1)
  })

  it('без живой операции (dead-letter) берет серверную версию и чистит очередь', async () => {
    await db.exercises.put({ id: 'ex1', name: 'Тяга блока', _dirty: 1 })
    await db.ex_outbox.add({ exerciseId: 'ex1', createdAt: T3, _dead: 1 })
    server.from = exercisesServer([{ id: 'ex1', name: 'Тяга', updated_at: T2 }])

    await pull(userId, new Set(), db)

    expect((await db.exercises.get('ex1')).name).toBe('Тяга')
    expect(await db.ex_outbox.count()).toBe(0)
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
    expect(state.prog).toEqual({ at: T3, dirty: 0, base: T3 })
  })

  it('часы телефона отстают: звезда, поставленная после синка, не откатывается собственной прошлой версией', async () => {
    const SRV = '2026-10-02T10:00:20.000Z'
    // прошлый синк: на сервере ['A'], базис = его updated_at
    await setMeta(`fav_${userId}`, ['A'], db)
    await setMeta('user_meta_state', { fav: { at: SRV, dirty: 0, base: SRV } }, db)
    // правка «через 10 с» по часам, отстающим на 15 с
    await setMeta(`fav_${userId}`, ['A', 'B'], db)
    await setMeta('user_meta_state', { fav: { at: '2026-10-02T10:00:15.000Z', dirty: 1, base: SRV } }, db)
    server.from = (call) => (call.table === 'user_meta'
      ? { data: [{ key: 'fav', value: ['A'], updated_at: SRV }], error: null }
      : defaultResponse(call))

    await pullUserMeta(userId, db)

    expect(await getMeta(`fav_${userId}`, db)).toEqual(['A', 'B'])
    expect((await getUserMetaState(db)).fav.dirty).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// pullRoster. Регрессия 29.07.2026 «у всех слетел пол»: ростер и его сигнатура
// лежали в РАЗНЫХ базах (данные — в общей loginDb, сигнатура — в персональной), и
// после того как экран входа портил кэш, pull считал, что тянуть нечего.
// ---------------------------------------------------------------------------
describe('pullRoster', () => {
  const ROSTER = [
    { id: 'r1', name: 'Дима', avatar_url: null, sort_order: 1, sex: 'm' },
    { id: 'r2', name: 'Оля', avatar_url: null, sort_order: 2, sex: 'f' },
  ]
  const FULL = 'id, name, avatar_url, sort_order, sex'

  // Проба видит две учетки; полная выборка отдает их с полом.
  function serveRoster(rows = ROSTER) {
    server.from = (call) => {
      if (call.table === 'login_users' && call.select === 'id, updated_at') {
        return { data: rows.map((u) => ({ id: u.id, updated_at: T2 })), error: null }
      }
      if (call.table === 'login_users') return { data: rows, error: null }
      return defaultResponse(call)
    }
  }
  const fullFetches = () =>
    server.calls.filter((c) => c.table === 'login_users' && c.select === FULL).length

  beforeEach(async () => {
    await loginDb.users.clear()
    await loginDb.meta.clear()
  })

  it('первый прогон: пишет ростер и кладет сигнатуру в login-meta, а не в персональную', async () => {
    serveRoster()
    await pull(userId, new Set(), db)

    expect((await loginDb.users.get('r2')).sex).toBe('f')
    expect(await getLoginMeta('sig_login_users')).toBeTruthy()
    expect(await getMeta('sig_login_users', db)).toBeUndefined()
  })

  it('проба не изменилась → тяжелой выборки больше нет', async () => {
    serveRoster()
    await pull(userId, new Set(), db)
    expect(fullFetches()).toBe(1)

    server.calls.length = 0
    await pull(userId, new Set(), db)
    expect(fullFetches()).toBe(0)
  })

  it('испорченный кэш лечится сам: старая сигнатура в персональной базе не мешает refetch', async () => {
    // Состояние клиента ДО обновления: экран входа стер sex, а сигнатура прошлого
    // прогона осталась в персональной meta — из-за нее refetch не наступал никогда.
    serveRoster()
    await loginDb.users.bulkPut([{ id: 'r1', name: 'Дима' }, { id: 'r2', name: 'Оля' }])
    await setMeta('sig_login_users', JSON.stringify([['r1', 'r2'], T2]), db)

    await pull(userId, new Set(), db)

    expect((await loginDb.users.get('r1')).sex).toBe('m')
    expect((await loginDb.users.get('r2')).sex).toBe('f')
  })

  it('проба изменилась (новая учетка) → полный refetch', async () => {
    serveRoster()
    await pull(userId, new Set(), db)
    server.calls.length = 0

    const grown = [...ROSTER, { id: 'r3', name: 'Женя', avatar_url: null, sort_order: 3, sex: 'm' }]
    serveRoster(grown)
    await pull(userId, new Set(), db)

    expect(fullFetches()).toBe(1)
    expect(await loginDb.users.count()).toBe(3)
  })

  // П3 (v6.16.4): ростер отдает только видимых. Учетка этого устройства, которую
  // вошедший не видит, остается в кэше — иначе пикер входа терял ее аватар и пол.
  it('учетку устройства не стираем, даже если вошедшему она не видна', async () => {
    serveRoster()
    await pull(userId, new Set(), db)
    await setLoginMeta('pin_r2', { pin_hash: 'h', pin_salt: 's', name: 'Оля' })

    serveRoster([ROSTER[0]]) // r2 вошедшему больше не видна
    await pull(userId, new Set(), db)

    expect((await loginDb.users.get('r2')).sex).toBe('f')
    expect(await loginDb.users.get('r1')).toBeTruthy()
  })

  it('чужую (не этого устройства) невидимую учетку из кэша убираем', async () => {
    serveRoster()
    await pull(userId, new Set(), db)

    serveRoster([ROSTER[0]])
    await pull(userId, new Set(), db)

    expect(await loginDb.users.get('r2')).toBeUndefined()
  })

  it('пустой (не ошибочный) ответ не затирает ростер и не сохраняет сигнатуру', async () => {
    serveRoster()
    await pull(userId, new Set(), db)
    const sig = await getLoginMeta('sig_login_users')

    // Проба показывает изменение, а полная выборка вернула пусто (сбой прав/RLS).
    server.from = (call) => {
      if (call.table === 'login_users' && call.select === 'id, updated_at') {
        return { data: [{ id: 'r1', updated_at: T3 }], error: null }
      }
      if (call.table === 'login_users') return { data: [], error: null }
      return defaultResponse(call)
    }
    await pull(userId, new Set(), db)

    expect(await loginDb.users.count()).toBe(2) // ростер цел
    expect(await getLoginMeta('sig_login_users')).toBe(sig) // следующий прогон повторит
  })

  it('ошибка полной выборки → предупреждение, кэш не тронут', async () => {
    serveRoster()
    await pull(userId, new Set(), db)

    server.from = (call) => {
      if (call.table === 'login_users' && call.select === 'id, updated_at') {
        return { data: [{ id: 'r1', updated_at: T3 }], error: null }
      }
      if (call.table === 'login_users') {
        return { data: null, error: { message: 'roster unavailable' } }
      }
      return defaultResponse(call)
    }
    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toContain('пользователи: roster unavailable')
    expect((await loginDb.users.get('r2')).sex).toBe('f')
  })
})
