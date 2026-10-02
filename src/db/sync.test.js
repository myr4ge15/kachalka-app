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
    workoutIds: [],   // ответ дешевого select('id') для реконсиляции удалений
    upsertWorkout: () => ({ error: null }), // (args) => {error}
    deleteWorkout: () => ({ error: null }),
    exFullFetches: 0, // сколько раз дернут ПОЛНЫЙ select справочника (не проба updated_at)
    identity: { known: false, id: null }, // ответ serverIdentity (кем сервер считает сессию)
    session: true, // hasSession
    sessionDelay: null, // промис, которого ждет hasSession (гонка двух syncNow)
    signOuts: 0,
    healFetches: [], // id, запрошенные дотягиванием .in('id', …)
  },
}))

// Замоканный Supabase: цепочки-билдеры «thenable», ответ выбирается по таблице/
// select/eq. Покрывает только то, что дергает syncNow в тестируемых сценариях.
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
      if (b._in) {
        // дотягивание по id (самолечение): отдаем строки из «полной» серверной истории
        state.healFetches.push(...b._in)
        const all = state.workoutsAll ?? state.workoutsMain
        return { data: all.filter((r) => b._in.includes(r.id)), error: null }
      }
      if (b._eqUser) {
        // инкрементально: если задан .gt('updated_at', wm) — отдаем только дельту
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
      eq(k, _v) { if (k === 'user_id') this._eqUser = true; return this },
      gt(k, v) { if (k === 'updated_at') this._gtUpdated = v; return this },
      in(k, v) { if (k === 'id') this._in = v; return this },
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
      signOut: async () => { state.signOuts++; return { error: null } },
    },
  }
  return {
    supabase, isConfigured: true, warmup() {},
    hasSession: async () => { if (state.sessionDelay) await state.sessionDelay; return state.session },
    serverIdentity: async () => { state.identityCalls = (state.identityCalls ?? 0) + 1; state.onIdentity?.(); return state.identity },
  }
})

// Тихий перевыпуск сессии (lib/auth) — управляется из теста.
vi.mock('../lib/auth.js', () => ({
  canRefreshSilently: () => srv.state.canRefresh,
  refreshSessionSilently: async () => { srv.state.refreshCalls++; return srv.state.refresh() },
}))

import { openUserDb, closeUserDb, db } from './local.js'
import { saveWorkout } from './repo.js'
import { syncNow, runOutbox, startSync, getSyncState } from './sync.js'
import { uniqueUserId } from '../test/idbHarness.js'

const bench = { id: 'ex_bench', name: 'Жим лежа', muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' }

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
  srv.state.identity = { known: true, id: userId } // сервер подтверждает: сессия наша
  srv.state.session = true
  srv.state.sessionDelay = null
  srv.state.signOuts = 0
  srv.state.canRefresh = false
  srv.state.refreshCalls = 0
  srv.state.refresh = () => false
  srv.state.healFetches = []
  srv.state.workoutsAll = null
  srv.state.identityCalls = 0
  srv.state.onIdentity = null
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

  it('dead-letter: после MAX_ATTEMPTS ошибок upsert операция помечается _dead, документ остается _dirty', async () => {
    srv.state.upsertWorkout = () => ({ error: { message: 'boom', code: '23503' } })
    const id = await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [{ exercise: bench, sets: [{ weight: 100, reps: 5 }] }] })
    for (let i = 0; i < 5; i++) await syncNow(userId) // MAX_ATTEMPTS = 5
    const op = await db.outbox.where('workoutId').equals(id).first()
    expect(op._dead).toBe(1)
    expect(op.attempts).toBe(5)
    const doc = await db.workouts.get(id)
    expect(doc._dirty).toBe(1) // правка не потеряна, ждет разбора
  })
})

describe('pull: merge-часы', () => {
  it('take-server: чистую локальную запись перезаписывает более свежая серверная', async () => {
    // чистый локальный документ (пришел ранее pull'ом)
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
    // грязный документ БЕЗ операции в очереди (push ничего не шлет) — базис = серверный updated_at
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

  it('conflict (сервер позже): серверная правка с другого устройства побеждает, проигравшая логируется', async () => {
    // Грязная локальная правка: базис T1, наша версия T2, сервер уехал до T3 (> базиса
    // И > нашей) → конфликт, серверная позже → принимаем серверную, конфликт в журнал.
    await db.workouts.put({
      id: 'cf1', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-02-01T00:00:00.000Z',
      _base_updated_at: '2026-01-10T00:00:00.000Z',
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 150, reps: 3 }] }],
      _dirty: 1, _deleted: 0,
    })
    srv.state.workoutsMain = [serverRow({ id: 'cf1', user_id: userId, updated_at: '2026-03-01T00:00:00.000Z', weight: 120 })]
    srv.state.workoutIds = ['cf1']
    await syncNow(userId)
    const doc = await db.workouts.get('cf1')
    expect(doc.entries[0].sets[0].weight).toBe(120) // серверная версия принята
    const log = await db.meta.get('merge_conflicts')
    expect(log.value).toHaveLength(1)
    expect(log.value[0]).toMatchObject({ id: 'cf1', winner: 'server' })
  })

  it('conflict (локальная позже): наша более поздняя правка выживает, но конфликт все равно виден в журнале', async () => {
    // Базис T1, сервер уехал до T2 (> базиса → конфликт), но наша версия T3 еще позже
    // → выживает локальная, push довезет; факт расхождения логируется.
    await db.workouts.put({
      id: 'cf2', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-03-01T00:00:00.000Z',
      _base_updated_at: '2026-01-10T00:00:00.000Z',
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 200, reps: 2 }] }],
      _dirty: 1, _deleted: 0,
    })
    srv.state.workoutsMain = [serverRow({ id: 'cf2', user_id: userId, updated_at: '2026-02-01T00:00:00.000Z', weight: 100 })]
    srv.state.workoutIds = ['cf2']
    await syncNow(userId)
    const doc = await db.workouts.get('cf2')
    expect(doc.entries[0].sets[0].weight).toBe(200) // локальная правка сохранена
    expect(doc._dirty).toBe(1)                      // ждет push
    const log = await db.meta.get('merge_conflicts')
    expect(log.value[0]).toMatchObject({ id: 'cf2', winner: 'local' })
  })

  it('реконсиляция удаления: чистую запись, которой нет на сервере, pull удаляет со ВТОРОГО прогона', async () => {
    await db.workouts.put({
      id: 'gone', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-01-10T00:00:00.000Z', _base_updated_at: null,
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 100, reps: 5 }] }],
      _dirty: 0, _deleted: 0,
    })
    srv.state.workoutsMain = [] // сервер записи не отдает
    srv.state.workoutIds = []   // и ее нет в полном списке id → удалена
    // Слайс 1 (v4.0.2): удаляем только после ДВУХ подряд отсутствий id — защита
    // чужой чистой записи от лага read-replica. Первый прогон лишь помечает
    // кандидата (запись остается), второй подтверждает и удаляет.
    await syncNow(userId)
    expect(await db.workouts.get('gone')).toBeTruthy() // 1-й прогон: кандидат, еще жива
    await syncNow(userId)
    expect(await db.workouts.get('gone')).toBeUndefined() // 2-й прогон: удалена
  })

  it('реконсиляция: запись, вернувшаяся на сервер после первого отсутствия, НЕ удаляется', async () => {
    await db.workouts.put({
      id: 'flap', user_id: userId, performed_at: '2026-01-10',
      created_at: '2026-01-10', updated_at: '2026-01-10T00:00:00.000Z', _base_updated_at: null,
      entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 100, reps: 5 }] }],
      _dirty: 0, _deleted: 0,
    })
    // 1-й прогон: реплика отстала — записи нет ни в контенте, ни в списке id → кандидат
    srv.state.workoutsMain = []
    srv.state.workoutIds = []
    await syncNow(userId)
    expect(await db.workouts.get('flap')).toBeTruthy()
    // 2-й прогон: реплика догнала — id снова в списке → снимаем с кандидатов, не удаляем
    srv.state.workoutIds = ['flap']
    await syncNow(userId)
    expect(await db.workouts.get('flap')).toBeTruthy()
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
    // локальная версия остается прежней (инкрементальный фильтр .gt отсек строку)
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

    // добавилась w2@T2; w1 остается @T1 (не в дельте > T1)
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

// Единый прогон очереди с политикой повторов/dead-letter (дедуп push-циклов).
// Тестируем на фейковой таблице — без Dexie/сети, только ветвление attempts/_dead.
function fakeTable(rows) {
  const store = new Map(rows.map((r) => [r.seq, { ...r }]))
  return {
    orderBy() { return { async toArray() { return [...store.values()].sort((a, b) => a.seq - b.seq) } } },
    async update(seq, patch) { const r = store.get(seq); if (r) Object.assign(r, patch) },
    async delete(seq) { store.delete(seq) },
    get(seq) { return store.get(seq) },
    get size() { return store.size },
  }
}

describe('runOutbox (дедуп push-циклов)', () => {
  it('успех: handler сам удаляет операции, идут по порядку seq', async () => {
    const t = fakeTable([{ seq: 2 }, { seq: 1 }, { seq: 3 }])
    const seen = []
    await runOutbox(t, async (op) => { seen.push(op.seq); await t.delete(op.seq) })
    expect(seen).toEqual([1, 2, 3]) // по возрастанию seq
    expect(t.size).toBe(0)         // все слито
  })

  it('deadLetter: первая ошибка (не достигнут MAX) растит attempts и БРОСАЕТ (стоп очереди)', async () => {
    const t = fakeTable([{ seq: 1 }])
    await expect(runOutbox(t, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(t.get(1).attempts).toBe(1)
    expect(t.get(1)._dead).toBeUndefined()
    expect(t.get(1).lastError).toBe('boom')
  })

  it('deadLetter: на MAX_ATTEMPTS помечает _dead и НЕ бросает (очередь не висит)', async () => {
    const t = fakeTable([{ seq: 1, attempts: 4 }]) // следующая попытка = 5 = MAX
    await expect(runOutbox(t, async () => { throw new Error('boom') })).resolves.toBeUndefined()
    expect(t.get(1).attempts).toBe(5)
    expect(t.get(1)._dead).toBe(1)
  })

  it('deadLetter: _dead-операции пропускаются', async () => {
    const t = fakeTable([{ seq: 1, _dead: 1 }])
    const seen = []
    await runOutbox(t, async (op) => { seen.push(op.seq) })
    expect(seen).toEqual([]) // отравленную не трогаем
  })

  it('deadLetter:false (реакции): ошибка НЕ бросает, копит attempts', async () => {
    const t = fakeTable([{ seq: 1 }, { seq: 2 }])
    const seen = []
    await runOutbox(t, async (op) => { seen.push(op.seq); throw new Error('x') }, { deadLetter: false })
    expect(seen).toEqual([1, 2])      // прошли всю очередь, не остановились
    expect(t.get(1).attempts).toBe(1) // остались с инкрементом, без _dead
    expect(t.get(1)._dead).toBeUndefined()
  })

  it('deadLetter:false: после MAX_ATTEMPTS операция ВЫБРАСЫВАЕТСЯ', async () => {
    const t = fakeTable([{ seq: 1, attempts: 4 }])
    await runOutbox(t, async () => { throw new Error('x') }, { deadLetter: false })
    expect(t.get(1)).toBeUndefined() // удалена, без dead-letter
    expect(t.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Регрессии РЕВЬЮ-КОДА-2026-10-02: отозванная сессия, параллельные прогоны,
// временные сбои сети, самолечение по id.
// ---------------------------------------------------------------------------
describe('syncNow: личность сессии и предохранитель удалений', () => {
  async function seedClean(ids) {
    for (const id of ids) {
      await db.workouts.put({
        id, user_id: userId, performed_at: '2026-01-10', created_at: '2026-01-10',
        updated_at: '2026-01-10T10:00:00Z', _dirty: 0, _deleted: 0, entries: [],
      })
    }
  }

  it('отозванная сессия (сервер нас не узнает): история НЕ стирается, прогон не идет, сессия гасится', async () => {
    await seedClean(['a', 'b'])
    await db.meta.put({ key: 'wm_workouts', value: '2026-01-10T10:00:00Z' })
    srv.state.identity = { known: true, id: null } // app_uid() = NULL
    srv.state.workoutIds = [] // RLS отдает пустоту без ошибки
    expect(await syncNow(userId)).toBe(false)
    expect(await syncNow(userId)).toBe(false)
    expect(await db.workouts.count()).toBe(2)
    expect(srv.state.signOuts).toBe(2)
  })

  it('сессия другой учетки по мнению сервера — прогон не идет', async () => {
    await seedClean(['a'])
    srv.state.identity = { known: true, id: 'someone-else' }
    expect(await syncNow(userId)).toBe(false)
    expect(await db.workouts.count()).toBe(1)
  })

  it('личность не проверена (старый сервер) + пустой список id: удаления пропущены, есть предупреждение', async () => {
    await seedClean(['a', 'b'])
    srv.state.identity = { known: false, id: null }
    srv.state.workoutIds = []
    await syncNow(userId)
    await syncNow(userId)
    await syncNow(userId)
    expect(await db.workouts.count()).toBe(2)
  })

  it('личность подтверждена + пустой список id: удаление со второй сверки работает как раньше', async () => {
    await seedClean(['a'])
    srv.state.workoutIds = []
    await syncNow(userId)
    expect(await db.workouts.count()).toBe(1)
    await syncNow(userId)
    expect(await db.workouts.count()).toBe(0)
  })

  it('самолечение: тренировка есть на сервере, локально нет и старше watermark — дотягивается по id', async () => {
    await seedClean(['a'])
    await db.meta.put({ key: 'wm_workouts', value: '2026-03-01T00:00:00Z' })
    srv.state.workoutIds = ['a', 'lost']
    srv.state.workoutsMain = [] // дельта пуста: обе старше watermark
    srv.state.workoutsAll = [serverRow({ id: 'lost', user_id: userId, updated_at: '2026-01-05T00:00:00Z', weight: 77 })]
    await syncNow(userId)
    const healed = await db.workouts.get('lost')
    expect(healed.entries[0].sets[0].weight).toBe(77)
    expect(srv.state.healFetches).toEqual(['lost'])
    // watermark дотягивание не двигает; повторный прогон ничего не запрашивает
    expect((await db.meta.get('wm_workouts')).value).toBe('2026-03-01T00:00:00Z')
    srv.state.healFetches = []
    await syncNow(userId)
    expect(srv.state.healFetches).toEqual([])
  })

  it('самолечение не воскрешает то, что удалено локально и ждет отправки', async () => {
    await db.workouts.put({
      id: 'tomb', user_id: userId, performed_at: '2026-01-10', created_at: '2026-01-10',
      updated_at: '2026-01-10T10:00:00Z', _dirty: 0, _deleted: 1, entries: [],
    })
    srv.state.workoutIds = ['tomb']
    srv.state.workoutsAll = [serverRow({ id: 'tomb', user_id: userId, updated_at: '2026-01-05T00:00:00Z' })]
    await syncNow(userId)
    expect(srv.state.healFetches).toEqual([])
    expect((await db.workouts.get('tomb'))._deleted).toBe(1)
  })
})

describe('syncNow: один прогон за раз', () => {
  it('два вызова подряд не идут параллельно (гард ставится до первого await)', async () => {
    await saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 100, reps: 5 }] }] })
    let calls = 0
    srv.state.upsertWorkout = () => { calls++; return { error: null } }
    let release
    srv.state.sessionDelay = new Promise((r) => { release = r })
    const first = syncNow(userId)
    const second = syncNow(userId)
    release()
    const res = await Promise.all([first, second])
    expect(res).toEqual([true, undefined])
    expect(calls).toBe(1)
  })

  it('сессии нет, но PIN в памяти: синк сам поднимает сессию и идет; повтор — не чаще раза в минуту', async () => {
    srv.state.session = false
    srv.state.canRefresh = true
    srv.state.refresh = () => false // сервер входа недоступен
    expect(await syncNow(userId)).toBeUndefined()
    expect(await syncNow(userId)).toBeUndefined() // в пределах минуты — без второй попытки
    expect(srv.state.refreshCalls).toBe(1)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 61000)
    srv.state.refresh = () => { srv.state.session = true; return true }
    expect(await syncNow(userId)).toBe(true)
    expect(srv.state.refreshCalls).toBe(2)
    vi.useRealTimers()
  })

  it('после прогона без сессии гард снят — следующий вызов идет', async () => {
    srv.state.session = false
    expect(await syncNow(userId)).toBeUndefined()
    srv.state.session = true
    expect(await syncNow(userId)).toBe(true)
  })
})

// РЕВЬЮ-КОДА-2026-10-02, мелочи: вызов syncNow посреди прогона раньше терялся
// (сохранение ждало поллинга 20–60 с) — теперь заказывает ровно один повтор.
describe('syncNow: повторный прогон по вызову во время прогона', () => {
  it('вызов во время прогона возвращает undefined, но после текущего идет еще один прогон', async () => {
    const during = []
    srv.state.onIdentity = () => {
      if (srv.state.identityCalls === 1) during.push(syncNow(userId), syncNow(userId), syncNow(userId))
    }
    expect(await syncNow(userId)).toBe(true)
    expect(await Promise.all(during)).toEqual([undefined, undefined, undefined])
    // три вызова во время прогона → ОДИН повтор (флаг, не очередь)
    expect(srv.state.identityCalls).toBe(2)
  })

  it('вызов от ДРУГОЙ учетки во время прогона повтор не заказывает', async () => {
    srv.state.onIdentity = () => { if (srv.state.identityCalls === 1) syncNow('other-user') }
    await syncNow(userId)
    expect(srv.state.identityCalls).toBe(1)
  })

  it('после неуспешного прогона повтор не делается (это забота поллинга)', async () => {
    srv.state.identity = { known: true, id: 'someone-else' }
    srv.state.onIdentity = () => { if (srv.state.identityCalls === 1) syncNow(userId) }
    expect(await syncNow(userId)).toBe(false)
    expect(srv.state.identityCalls).toBe(1)
  })
})

describe('startSync: состояние прошлой учетки сбрасывается', () => {
  it('ошибка учетки A не видна учетке B после старта ее синка', async () => {
    srv.state.identity = { known: true, id: 'someone-else' }
    await syncNow(userId)
    expect(getSyncState().lastError).toBeTruthy()
    expect(getSyncState().netError).toBe(true)
    await closeUserDb() // учетка A вышла; синк B стартует до открытия ее базы — прогон пропущен
    const stop = startSync(() => 'user-b')
    try {
      expect(getSyncState().lastError).toBeNull()
      expect(getSyncState().netError).toBe(false)
      expect(getSyncState().lastSyncAt).toBeNull()
    } finally { stop() }
  })
})

describe('push: временные сбои не считаются попытками', () => {
  async function saveOne() {
    return saveWorkout({ user_id: userId, performed_at: '2026-01-10', entries: [{ exercise_id: bench.id, exercise: bench, sets: [{ weight: 100, reps: 5 }] }] })
  }

  it('десять сетевых сбоев подряд не отправляют операцию в dead-letter', async () => {
    const id = await saveOne()
    srv.state.upsertWorkout = () => ({ error: { message: 'TypeError: Failed to fetch', code: '' } })
    for (let i = 0; i < 10; i++) expect(await syncNow(userId)).toBe(false)
    const op = await db.outbox.where('workoutId').equals(id).first()
    expect(op._dead).toBeFalsy()
    expect(op.attempts).toBe(0)
    expect(op.lastError).toContain('Failed to fetch')
    // связь вернулась — операция уезжает
    srv.state.upsertWorkout = () => ({ error: null })
    srv.state.workoutIds = [id]
    expect(await syncNow(userId)).toBe(true)
    expect(await db.outbox.count()).toBe(0)
  })

  it('ошибка данных от сервера по-прежнему доводит до dead-letter за 5 попыток', async () => {
    const id = await saveOne()
    srv.state.upsertWorkout = () => ({ error: { message: 'violates foreign key', code: '23503' } })
    for (let i = 0; i < 5; i++) await syncNow(userId)
    const op = await db.outbox.where('workoutId').equals(id).first()
    expect(op._dead).toBe(1)
  })
})

describe('pull: правка упражнения на сервере освежает снимок в старых тренировках (п. 17)', () => {
  it('переименование/смена типа: чистые тренировки с этим упражнением перечитываются по id', async () => {
    // первый прогон: справочник и тренировка
    srv.state.exercises = [{ ...bench, updated_at: '2026-01-01T00:00:00Z' }]
    srv.state.workoutsMain = [serverRow({ id: 'w1', user_id: userId, updated_at: '2026-01-10T00:00:00Z' })]
    srv.state.workoutIds = ['w1']
    await syncNow(userId)
    expect((await db.workouts.get('w1')).entries[0].exercise.name).toBe('Жим лежа')

    // админ переименовал упражнение: тренировка на сервере НЕ менялась (updated_at тот же)
    srv.state.exercises = [{ ...bench, name: 'Жим штанги лежа', updated_at: '2026-02-01T00:00:00Z' }]
    const renamed = serverRow({ id: 'w1', user_id: userId, updated_at: '2026-01-10T00:00:00Z' })
    renamed.workout_exercises[0].exercise.name = 'Жим штанги лежа'
    srv.state.workoutsAll = [renamed]
    srv.state.healFetches = []
    await syncNow(userId)
    expect(srv.state.healFetches).toEqual(['w1'])
    expect((await db.workouts.get('w1')).entries[0].exercise.name).toBe('Жим штанги лежа')

    // справочник больше не менялся — повторного перечитывания нет
    srv.state.healFetches = []
    await syncNow(userId)
    expect(srv.state.healFetches).toEqual([])
  })

  it('тренировку с неотправленной правкой не перезаписывает', async () => {
    srv.state.exercises = [{ ...bench, updated_at: '2026-01-01T00:00:00Z' }]
    srv.state.workoutsMain = [serverRow({ id: 'w1', user_id: userId, updated_at: '2026-01-10T00:00:00Z' })]
    srv.state.workoutIds = ['w1']
    await syncNow(userId)
    await db.workouts.update('w1', { _dirty: 1 })
    srv.state.exercises = [{ ...bench, name: 'Новое имя', updated_at: '2026-02-01T00:00:00Z' }]
    srv.state.healFetches = []
    expect(await syncNow(userId)).toBe(true) // прогон прошел целиком
    expect(srv.state.healFetches).toEqual([])
    expect((await db.workouts.get('w1')).entries[0].exercise.name).toBe('Жим лежа')
  })
})
