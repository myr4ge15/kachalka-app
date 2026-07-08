// Интеграционные тесты движка синхронизации (db/sync.js) на реальном Dexie
// (fake-indexeddb) с замоканным Supabase-клиентом. Фокус — push (слив очереди
// outbox, dead-letter) и pull-merge (take-server / keep-local / реконсиляция
// удалений): самый рискованный по потере данных путь.
import 'fake-indexeddb/auto' // ПЕРВЫМ: глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Разделяемое состояние «сервера». Через vi.hoisted — чтобы фабрика vi.mock
// (поднимается выше импортов) могла на него ссылаться.
const srv = vi.hoisted(() => ({
  state: {
    exercises: [],
    loginUsers: [],
    workoutsMain: [], // ответ основного оконного запроса тренировок (SELECT_WORKOUT)
    workoutIds: [],   // ответ дешёвого select('id') для реконсиляции удалений
    upsertWorkout: () => ({ error: null }), // (args) => {error}
    deleteWorkout: () => ({ error: null }),
    exFullFetches: 0, // сколько раз дёрнут ПОЛНЫЙ select справочника (не проба updated_at)
  },
}))

// Замоканный Supabase: цепочки-билдеры «thenable», ответ выбирается по таблице/
// select/eq. Покрывает только то, что дёргает syncNow в тестируемых сценариях.
vi.mock('./supabase.js', () => {
  const { state } = srv
  function resolveFrom(b) {
    if (b._table === 'exercises') {
      if (b._upsert) return { error: null } // pushExercises upsert
      // проба инкрементального pull: select только updated_at (order desc limit 1)
      if (b._select === 'updated_at') {
        const rows = [...state.exercises].filter((e) => e.updated_at)
          .sort((a, c) => (a.updated_at < c.updated_at ? 1 : -1))
        return { data: rows.slice(0, 1), error: null }
      }
      state.exFullFetches++ // ПОЛНЫЙ select (id, name, ...) — считаем для теста «skip»
      return { data: state.exercises, error: null }
    }
    if (b._table === 'login_users') return { data: state.loginUsers, error: null }
    if (b._table === 'workouts') {
      if (b._delete) return state.deleteWorkout(b)
      if (b._select === 'id') return { data: state.workoutIds.map((id) => ({ id })), error: null }
      if (b._eqUser) {
        // инкрементально: если задан .gt('updated_at', wm) — отдаём только дельту
        let rows = state.workoutsMain
        if (b._gtUpdated) rows = rows.filter((r) => r.updated_at > b._gtUpdated)
        return { data: rows, error: null }
      }
      return { data: [], error: null } // запрос ленты (fetchFeed) — пусто
    }
    if (b._table === 'workout_templates') return { data: [], error: null }
    if (b._table === 'goals') return { data: [], error: null }
    return { data: [], error: null }
  }
  function builder(table) {
    return {
      _table: table, _select: null, _delete: false, _upsert: null, _eqUser: false, _gtUpdated: null,
      select(s) { this._select = s; return this },
      eq(k, v) { if (k === 'user_id') this._eqUser = true; return this },
      gt(k, v) { if (k === 'updated_at') this._gtUpdated = v; return this },
      order() { return this },
      limit() { return this },
      or() { return this },
      upsert(v) { this._upsert = v; return this },
      delete() { this._delete = true; return this },
      then(res, rej) { return Promise.resolve(resolveFrom(this)).then(res, rej) },
    }
  }
  function rpc(name, args) {
    const run = () => {
      if (name === 'my_is_private') return { data: false, error: null }
      if (name === 'upsert_workout') return state.upsertWorkout(args)
      return { data: null, error: null }
    }
    return { then(res, rej) { return Promise.resolve(run()).then(res, rej) } }
  }
  const supabase = {
    from: (t) => builder(t),
    rpc,
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'x' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }
  return { supabase, isConfigured: true, hasSession: async () => true, warmup() {} }
})

import { openUserDb, closeUserDb, db } from './local.js'
import { saveWorkout } from './repo.js'
import { syncNow } from './sync.js'
import { uniqueUserId } from '../test/idbHarness.js'

const bench = { id: 'ex_bench', name: 'Жим лёжа', muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' }

// server row в форме SELECT_WORKOUT (для rowToDoc в pull).
function serverRow({ id, user_id, performed_at = '2026-01-10', updated_at, weight = 100, reps = 5 }) {
  return {
    id, user_id, performed_at,
    created_at: performed_at,
    updated_at,
    workout_exercises: [{
      id: 'we_' + id, position: 0, exercise_id: bench.id,
      exercise: { id: bench.id, name: bench.name, muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' },
      sets: [{ id: 's_' + id, set_number: 0, weight, reps }],
    }],
  }
}

// navigator.onLine нужен sync/feed; в node его нет (или он не перезаписываем) —
// определяем через defineProperty (обычное присваивание может кинуть/не сработать).
function setOnline(on) {
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: on }, configurable: true, writable: true,
    })
  } catch {
    try { globalThis.navigator.onLine = on } catch { /* оставляем как есть */ }
  }
}

let userId
beforeEach(async () => {
  setOnline(true)
  userId = uniqueUserId()
  await openUserDb(userId)
  // сброс серверного состояния
  srv.state.exercises = []
  srv.state.loginUsers = []
  srv.state.workoutsMain = []
  srv.state.workoutIds = []
  srv.state.upsertWorkout = () => ({ error: null })
  srv.state.deleteWorkout = () => ({ error: null })
  srv.state.exFullFetches = 0
})
afterEach(async () => {
  await closeUserDb()
  vi.restoreAllMocks()
})

describe('push: слив очереди outbox', () => {
  it('успешный upsert сливает очередь и снимает _dirty/_base', async () => {
    const id = await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [{ exercise: bench, sets: [{ weight: 100, reps: 5 }] }] })
    expect(await db.outbox.count()).toBe(1)
    await syncNow(userId)
    expect(await db.outbox.count()).toBe(0) // очередь слита
    const doc = await db.workouts.get(id)
    expect(doc._dirty).toBe(0)
    expect(doc._base_updated_at).toBe(null)
  })

  it('dead-letter: после MAX_ATTEMPTS ошибок upsert операция помечается _dead, документ остаётся _dirty', async () => {
    srv.state.upsertWorkout = () => ({ error: { message: 'boom' } })
    const id = await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [{ exercise: bench, sets: [{ weight: 100, reps: 5 }] }] })
    for (let i = 0; i < 5; i++) await syncNow(userId) // MAX_ATTEMPTS = 5
    const op = await db.outbox.where('workoutId').equals(id).first()
    expect(op._dead).toBe(1)
    expect(op.attempts).toBe(5)
    const doc = await db.workouts.get(id)
    expect(doc._dirty).toBe(1) // правка не потеряна, ждёт разбора
  })
})

describe('pull: merge-часы', () => {
  it('take-server: чистую локальную запись перезаписывает более свежая серверная', async () => {
    // чистый локальный документ (пришёл ранее pull'ом)
    await db.workouts.put({
      id: 'w1', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-01-10T00:00:00.000Z', _base_updated_at: null,
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 100, reps: 5 }] }],
      _dirty: 0, _deleted: 0,
    })
    srv.state.workoutsMain = [serverRow({ id: 'w1', user_id: userId, updated_at: '2026-02-01T00:00:00.000Z', weight: 120 })]
    srv.state.workoutIds = ['w1']
    await syncNow(userId)
    const doc = await db.workouts.get('w1')
    expect(doc.entries[0].sets[0].weight).toBe(120) // принята серверная версия
  })

  it('keep-local: грязную локальную правку (сервер не новее базиса) pull не трогает', async () => {
    // грязный документ БЕЗ операции в очереди (push ничего не шлёт) — базис = серверный updated_at
    await db.workouts.put({
      id: 'w2', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-01-15T00:00:00.000Z',
      _base_updated_at: '2026-01-12T00:00:00.000Z',
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 200, reps: 3 }] }],
      _dirty: 1, _deleted: 0,
    })
    // сервер показывает СТАРУЮ версию (updated_at == базис) → keep-local
    srv.state.workoutsMain = [serverRow({ id: 'w2', user_id: userId, updated_at: '2026-01-12T00:00:00.000Z', weight: 100 })]
    srv.state.workoutIds = ['w2']
    await syncNow(userId)
    const doc = await db.workouts.get('w2')
    expect(doc.entries[0].sets[0].weight).toBe(200) // локальная правка сохранена
    expect(doc._dirty).toBe(1)
  })

  it('реконсиляция удаления: чистую запись, которой нет на сервере, pull удаляет локально', async () => {
    await db.workouts.put({
      id: 'gone', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-01-10T00:00:00.000Z', _base_updated_at: null,
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 100, reps: 5 }] }],
      _dirty: 0, _deleted: 0,
    })
    srv.state.workoutsMain = [] // сервер записи не отдаёт
    srv.state.workoutIds = []   // и её нет в полном списке id → удалена
    await syncNow(userId)
    expect(await db.workouts.get('gone')).toBeUndefined()
  })

  it('реконсиляция НЕ трогает грязную локальную запись, отсутствующую на сервере', async () => {
    await db.workouts.put({
      id: 'localonly', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-01-10T00:00:00.000Z', _base_updated_at: null,
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 100, reps: 5 }] }],
      _dirty: 1, _deleted: 0,
    })
    srv.state.workoutsMain = []
    srv.state.workoutIds = []
    await syncNow(userId)
    expect(await db.workouts.get('localonly')).toBeTruthy() // несинхрон. правка защищена
  })
})

describe('pull: инкрементальный watermark', () => {
  const T1 = '2026-01-10T00:00:00.000Z'
  const T2 = '2026-02-01T00:00:00.000Z'

  it('тренировки: правка БЕЗ роста updated_at не тянется, с ростом — тянется', async () => {
    // 1-й прогон: пришла w1@T1 (weight 100) → local, watermark = T1
    srv.state.workoutsMain = [serverRow({ id: 'w1', user_id: userId, updated_at: T1, weight: 100 })]
    srv.state.workoutIds = ['w1']
    await syncNow(userId)
    expect((await db.workouts.get('w1')).entries[0].sets[0].weight).toBe(100)

    // сервер «изменил» контент, но updated_at НЕ вырос (== T1) → дельта пуста →
    // локальная версия остаётся прежней (инкрементальный фильтр .gt отсёк строку)
    srv.state.workoutsMain = [serverRow({ id: 'w1', user_id: userId, updated_at: T1, weight: 999 })]
    await syncNow(userId)
    expect((await db.workouts.get('w1')).entries[0].sets[0].weight).toBe(100)

    // теперь updated_at вырос до T2 → строка попадает в дельту → принимаем 999
    srv.state.workoutsMain = [serverRow({ id: 'w1', user_id: userId, updated_at: T2, weight: 999 })]
    await syncNow(userId)
    expect((await db.workouts.get('w1')).entries[0].sets[0].weight).toBe(999)
  })

  it('тренировки: новая запись в дельте добавляется, старая не перекачивается', async () => {
    srv.state.workoutsMain = [serverRow({ id: 'w1', user_id: userId, updated_at: T1, weight: 100 })]
    srv.state.workoutIds = ['w1']
    await syncNow(userId)

    // добавилась w2@T2; w1 остаётся @T1 (не в дельте > T1)
    srv.state.workoutsMain = [
      serverRow({ id: 'w1', user_id: userId, updated_at: T1, weight: 100 }),
      serverRow({ id: 'w2', user_id: userId, updated_at: T2, weight: 80 }),
    ]
    srv.state.workoutIds = ['w1', 'w2']
    await syncNow(userId)
    expect(await db.workouts.get('w1')).toBeTruthy()
    expect((await db.workouts.get('w2')).entries[0].sets[0].weight).toBe(80)
  })

  it('справочник: не перекачивается, если max(updated_at) не вырос', async () => {
    srv.state.exercises = [{ ...bench, updated_at: T1 }]
    await syncNow(userId)
    const after1 = srv.state.exFullFetches
    expect(after1).toBeGreaterThanOrEqual(1) // первый прогон — полный refetch
    // второй прогон, справочник тот же → проба видит тот же T1 → полного fetch НЕТ
    await syncNow(userId)
    expect(srv.state.exFullFetches).toBe(after1)
    // справочник изменился (updated_at вырос) → снова полный refetch
    srv.state.exercises = [{ ...bench, updated_at: T2 }]
    await syncNow(userId)
    expect(srv.state.exFullFetches).toBe(after1 + 1)
  })
})
