// Края стадии PULL на реальном Dexie (fake-indexeddb) и замоканном Supabase: чем кончается
// сбой каждой подтяжки, что остается в базе при пустом/ошибочном ответе, правка во время
// запроса, журнал конфликтов, дотягивание и перечитывание по id. Основные пути — pull.test.js
// и sync.test.js; здесь — ветки с риском тихой потери данных (покрытие веток, 30.10.2026).
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const server = vi.hoisted(() => ({
  calls: [],
  from: () => ({ data: [], error: null }),
  rpc: () => ({ data: false, error: null }),
}))

// Ответ server.from может быть значением, промисом или броском (сетевой сбой, таймаут).
vi.mock('../supabase.js', () => {
  function from(table) {
    return {
      table,
      selection: '',
      filters: {},
      inIds: null,
      gtFilter: null,
      select(selection) { this.selection = selection; return this },
      eq(key, value) { this.filters[key] = value; return this },
      gt(key, value) { this.gtFilter = { key, value }; return this },
      in(key, value) { this.inIds = value; return this },
      order() { return this },
      or() { return this },
      then(ok, fail) {
        const call = { table, select: this.selection, filters: this.filters, in: this.inIds, gt: this.gtFilter }
        server.calls.push(call)
        return new Promise((resolve) => resolve(server.from(call))).then(ok, fail)
      },
    }
  }
  const rpc = (name, args) => ({
    then(ok, fail) {
      return new Promise((resolve) => resolve(server.rpc(name, args))).then(ok, fail)
    },
  })
  return { supabase: { from, rpc } }
})

import { openUserDb, closeUserDb, db, loginDb, getMeta, setMeta, getLoginMeta } from '../local.js'
import { readGoals, writeGoals } from '../notifications.js'
import { getUserMetaState } from '../userMeta.js'
import { resetPhaseColumn } from '../phaseColumn.js'
import { pull, pullGoal, pullUserMeta } from './pull.js'
import { uniqueUserId } from '../../test/idbHarness.js'

const T1 = '2026-07-01T10:00:00.000Z'
const T2 = '2026-07-20T10:00:00.000Z'
const T3 = '2026-07-29T10:00:00.000Z'
const VERIFIED = { identityVerified: true }

const isProbe = (c) => c.select === 'id, updated_at'
const isIds = (c) => c.table === 'workouts' && c.select === 'id'
const isHeal = (c) => c.table === 'workouts' && c.in
const isDelta = (c) => c.table === 'workouts' && c.select !== 'id' && !c.in
const isFull = (table) => (c) => c.table === table && !isProbe(c)

const ok = (data) => ({ data, error: null })
const fail = (message) => ({ data: null, error: { message } })

let userId

// Маршрутизатор ответов: первое совпавшее правило, иначе пустой успешный ответ.
function serve(...rules) {
  server.from = (call) => {
    for (const [match, answer] of rules) {
      if (match(call)) return typeof answer === 'function' ? answer(call) : answer
    }
    return ok([])
  }
}

function row(id, { updated_at = T3, weight = 100, exerciseId = 'ex1', name = 'Жим лежа' } = {}) {
  return {
    id,
    user_id: userId,
    performed_at: '2026-07-28',
    created_at: T2,
    updated_at,
    workout_exercises: [{
      id: `we-${id}`,
      position: 0,
      exercise_id: exerciseId,
      exercise: { id: exerciseId, name, muscle_group: 'грудь', metric: 'weight' },
      sets: [{ id: `s-${id}`, set_number: 0, weight, reps: 5 }],
    }],
  }
}

function localWorkout(id, patch = {}) {
  return {
    id,
    user_id: userId,
    performed_at: '2026-07-28',
    created_at: T1,
    updated_at: T1,
    _dirty: 0,
    _deleted: 0,
    entries: [{ exercise_id: 'ex1', exercise: { id: 'ex1', name: 'Жим лежа' }, sets: [{ weight: 50, reps: 5 }] }],
    ...patch,
  }
}
const seed = (...docs) => db.workouts.bulkPut(docs)
const weightOf = async (id) => (await db.workouts.get(id)).entries[0].sets[0].weight

const localTemplate = (id, patch = {}) => ({
  id, user_id: userId, name: 'План', is_public: 0, updated_at: T1, exercises: [], _dirty: 0, _deleted: 0, ...patch,
})

beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  await loginDb.users.clear()
  await loginDb.meta.clear()
  server.calls.length = 0
  server.from = () => ok([])
  server.rpc = () => ok(false)
})

afterEach(async () => {
  vi.restoreAllMocks()
  resetPhaseColumn()
  await closeUserDb()
})

describe('документ из серверной строки', () => {
  it('упражнения и подходы ложатся по position/set_number, вес и повторы — числа, разминка сохраняется', async () => {
    const w = row('w1')
    w.workout_exercises = [
      {
        position: 1,
        exercise_id: 'ex2',
        phase: 'cooldown',
        exercise: { id: 'ex2', name: 'Тяга' },
        sets: [
          { set_number: 2, weight: '60.5', reps: '8' },
          { set_number: 1, weight: '50', reps: '10' },
        ],
      },
      { position: 0, exercise_id: 'ex1', phase: 'warmup', exercise: { id: 'ex1', name: 'Жим' }, sets: [] },
    ]
    serve([isDelta, ok([w])], [isIds, ok([{ id: 'w1' }])])

    await pull(userId, new Set(), db)

    const doc = await db.workouts.get('w1')
    expect(doc.entries.map((e) => [e.exercise_id, e.phase])).toEqual([['ex1', 'warmup'], ['ex2', 'cooldown']])
    expect(doc.entries[1].sets).toEqual([{ weight: 50, reps: 10 }, { weight: 60.5, reps: 8 }])
  })

  it('строка без join упражнения и без подходов не теряется: заглушка «—», пустые подходы', async () => {
    const noPosition = { exercise_id: 'gone', exercise: null, sets: null }
    const empty = { ...row('w2'), workout_exercises: null }
    serve([isDelta, ok([{ ...row('w1'), workout_exercises: [noPosition] }, empty])], [isIds, ok([{ id: 'w1' }, { id: 'w2' }])])

    await pull(userId, new Set(), db)

    expect((await db.workouts.get('w1')).entries).toEqual([
      { exercise_id: 'gone', exercise: { id: 'gone', name: '—' }, sets: [] },
    ])
    expect((await db.workouts.get('w2')).entries).toEqual([])
  })

  it('старый сервер без position/set_number: порядок ответа сохраняется, ничего не теряется', async () => {
    const w = row('w1')
    w.workout_exercises = [
      { exercise_id: 'a', exercise: { id: 'a', name: 'А' }, sets: [{ weight: 1, reps: 1 }, { weight: 2, reps: 2 }] },
      { exercise_id: 'b', exercise: { id: 'b', name: 'Б' }, sets: [] },
    ]
    const tpl = { id: 'tpl', user_id: userId, name: 'П', updated_at: T2, template_exercises: [{ exercise_id: 'a' }, { exercise_id: 'b' }] }
    serve([isDelta, ok([w])], [isIds, ok([{ id: 'w1' }])], [isFull('workout_templates'), ok([tpl])])

    await pull(userId, new Set(), db)

    const doc = await db.workouts.get('w1')
    expect(doc.entries.map((e) => e.exercise_id)).toEqual(['a', 'b'])
    expect(doc.entries[0].sets.map((x) => x.weight)).toEqual([1, 2])
    expect((await db.templates.get('tpl')).exercises.map((e) => [e.exercise_id, e.position])).toEqual([['a', 0], ['b', 1]])
  })

  it('старый сервер без created_at/updated_at: даты подставлены, watermark не двигается', async () => {
    const legacy = { id: 'w1', user_id: userId, performed_at: '2026-07-28', workout_exercises: [] }
    const midAge = { ...legacy, id: 'w2', created_at: T2 }
    serve([isDelta, ok([legacy, midAge])], [isIds, ok([{ id: 'w1' }, { id: 'w2' }])])

    await pull(userId, new Set(), db)

    const doc = await db.workouts.get('w1')
    expect(doc.created_at).toBe('2026-07-28')
    expect(doc.updated_at).toBeTruthy()
    expect((await db.workouts.get('w2')).updated_at).toBe(T2)
    expect(await getMeta('wm_workouts', db)).toBeUndefined()
  })

  it('шаблон: порядок, сквозные позиции, план, разминка, автор и видимость', async () => {
    const tpl = {
      id: 'tpl',
      user_id: 'friend',
      name: 'От друга',
      is_public: true,
      author: { name: 'Оля' },
      created_at: T1,
      updated_at: T2,
      template_exercises: [
        { position: 5, exercise_id: 'ex2', phase: 'warmup', exercise: { id: 'ex2', name: 'Тяга' }, target_sets: 3, target_reps: 10, target_weight: '42.5' },
        { position: 1, exercise_id: 'gone', exercise: null },
      ],
    }
    const bare = { id: 'bare', user_id: userId, name: 'Старый' }
    serve([isFull('workout_templates'), ok([tpl, bare])])

    await pull(userId, new Set(), db)

    const doc = await db.templates.get('tpl')
    expect(doc).toMatchObject({ is_public: 1, author_name: 'Оля', created_at: T1, updated_at: T2 })
    expect(doc.exercises).toEqual([
      { exercise_id: 'gone', exercise: { id: 'gone', name: '—' }, position: 0, sets: null, reps: null, weight: null },
      { exercise_id: 'ex2', exercise: expect.objectContaining({ id: 'ex2', name: 'Тяга' }), position: 1, phase: 'warmup', sets: 3, reps: 10, weight: 42.5 },
    ])
    const old = await db.templates.get('bare')
    expect(old).toMatchObject({ is_public: 0, author_name: null, exercises: [] })
    expect(old.updated_at).toBeTruthy()
  })
})

describe('граница критичности: тренировки важнее остального', () => {
  it('сбой справочника, ростера и шаблонов — предупреждения, а тренировка принята и прогон не падает', async () => {
    serve(
      [(c) => c.table === 'exercises', () => { throw new Error('справочник лег') }],
      [(c) => c.table === 'login_users', () => { throw new Error('ростер лег') }],
      [(c) => c.table === 'workout_templates', () => { throw 'шаблоны легли' }], // не Error — строка
      [isDelta, ok([row('w1')])],
      [isIds, ok([{ id: 'w1' }])],
    )

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toEqual(expect.arrayContaining(['справочник лег', 'ростер лег', 'шаблоны легли']))
    expect(await weightOf('w1')).toBe(100)
    expect(await getMeta('wm_workouts', db)).toBe(T3)
  })

  it('упали и тренировки, и остальное: наружу уходит ошибка тренировок, база и watermark не тронуты', async () => {
    await seed(localWorkout('w1'))
    serve(
      [(c) => c.table === 'exercises', () => { throw new Error('справочник лег') }],
      [isDelta, () => { throw new Error('тренировки легли') }],
      [isIds, ok([])],
    )

    await expect(pull(userId, new Set(), db, VERIFIED)).rejects.toThrow('тренировки легли')

    expect(await db.workouts.get('w1')).toBeTruthy()
    expect(await getMeta('pending_workout_deletes', db)).toBeUndefined()
    expect(await getMeta('wm_workouts', db)).toBeUndefined()
  })

  it('ошибка без message все равно читается в предупреждении', async () => {
    const plain = { data: null, error: 'нет прав' }
    serve(
      [isFull('exercises'), plain],
      [isFull('login_users'), plain],
      [isFull('workout_templates'), plain],
      [isIds, plain],
    )
    const warnings = await pull(userId, new Set(), db)
    expect(warnings).toEqual(expect.arrayContaining([
      'упражнения: нет прав', 'пользователи: нет прав', 'шаблоны: нет прав', 'удаления не сверены: нет прав',
    ]))
  })
})

describe('флаг приватности', () => {
  it('ответ сервера записывается', async () => {
    server.rpc = () => ok(true)
    await pull(userId, new Set(), db)
    expect(await getMeta(`priv_${userId}`, db)).toBe(true)
  })

  it.each([
    ['ошибка', () => fail('нет функции')],
    ['сеть', () => { throw new Error('offline') }],
  ])('%s: прежнее значение остается, прогон без предупреждений', async (_name, rpc) => {
    await setMeta(`priv_${userId}`, true, db)
    server.rpc = rpc
    const warnings = await pull(userId, new Set(), db)
    expect(await getMeta(`priv_${userId}`, db)).toBe(true)
    expect(warnings).toEqual([])
  })
})

describe('сверка удалений тренировок', () => {
  it.each([
    ['ошибка', () => fail('ids timeout')],
    ['сеть', () => { throw new Error('ids timeout') }],
  ])('список id недоступен (%s): дельта принята, удаления пропущены, кандидаты сохранены', async (_name, ids) => {
    await seed(localWorkout('old'))
    await setMeta('pending_workout_deletes', ['old'], db)
    serve([isDelta, ok([row('w1')])], [isIds, ids])

    const warnings = await pull(userId, new Set(), db, VERIFIED)

    expect(warnings).toContain('удаления не сверены: ids timeout')
    expect(await db.workouts.get('old')).toBeTruthy()
    expect(await weightOf('w1')).toBe(100)
    expect(await getMeta('pending_workout_deletes', db)).toEqual(['old'])
    expect(await getMeta('wm_workouts', db)).toBe(T3)
    expect(server.calls.filter(isHeal)).toEqual([])
  })

  it('пустой список без подтвержденной личности не подтверждает даже прошлого кандидата', async () => {
    await seed(localWorkout('old'))
    await setMeta('pending_workout_deletes', ['old'], db)

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toContain('удаления не сверены: сервер вернул пустой список')
    expect(await db.workouts.get('old')).toBeTruthy()
    expect(await getMeta('pending_workout_deletes', db)).toEqual(['old'])
  })

  it('тот же кандидат при подтвержденной личности удаляется', async () => {
    await seed(localWorkout('old'))
    await setMeta('pending_workout_deletes', ['old'], db)

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.workouts.get('old')).toBeUndefined()
    expect(await getMeta('pending_workout_deletes', db)).toEqual([])
  })

  it('только грязные записи: пустой список без личности не шумит и правку не трогает', async () => {
    await seed(localWorkout('mine', { _dirty: 1 }))

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toEqual([])
    expect(await db.workouts.get('mine')).toBeTruthy()
  })

  it('только что отправленную тренировку лаг реплики не удаляет ни с какой сверки', async () => {
    await seed(localWorkout('fresh'))
    await setMeta('pending_workout_deletes', ['fresh'], db)

    await pull(userId, new Set(['fresh']), db, VERIFIED)
    await pull(userId, new Set(['fresh']), db, VERIFIED)

    expect(await db.workouts.get('fresh')).toBeTruthy()
    expect(await getMeta('pending_workout_deletes', db)).toEqual([])
  })

  it('тренировка чужой учетки на устройстве в сверке не участвует', async () => {
    await seed(localWorkout('foreign', { user_id: 'other' }))
    await setMeta('pending_workout_deletes', ['foreign'], db)

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.workouts.get('foreign')).toBeTruthy()
  })
})

describe('merge-часы: что выживает', () => {
  const delta = (...rows) => serve([isDelta, ok(rows)], [isIds, ok(rows.map((r) => ({ id: r.id })))])

  it('тумбстон сильнее свежей серверной строки: удаление не отменяется', async () => {
    await seed(localWorkout('w1', { _deleted: 1, _dirty: 1, _base_updated_at: T1 }))
    delta(row('w1', { updated_at: T3 }))

    const warnings = await pull(userId, new Set(), db)

    expect((await db.workouts.get('w1'))._deleted).toBe(1)
    expect(await getMeta('merge_conflicts', db)).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('грязная запись без базиса (создана здесь): сервер не трогает ее, конфликта нет', async () => {
    await seed(localWorkout('w1', { _dirty: 1, _base_updated_at: null }))
    delta(row('w1'))

    await pull(userId, new Set(), db)

    expect(await weightOf('w1')).toBe(50)
    expect(await getMeta('merge_conflicts', db)).toBeUndefined()
  })

  it('конфликт в пользу сервера: виден в журнале и в предупреждении, снимаются только upsert-операции', async () => {
    await seed(localWorkout('w1', { _dirty: 1, _base_updated_at: T1, updated_at: T2 }))
    await db.outbox.bulkAdd([
      { workoutId: 'w1', type: 'upsert', attempts: 0 },
      { workoutId: 'w1', type: 'upsert', attempts: 5, _dead: 1 },
      { workoutId: 'w1', type: 'delete', attempts: 0 },
      { workoutId: 'other', type: 'upsert', attempts: 0 },
    ])
    delta(row('w1', { updated_at: T3 }))

    const warnings = await pull(userId, new Set(), db)

    expect(await weightOf('w1')).toBe(100)
    expect((await db.workouts.get('w1'))._dirty).toBe(0)
    expect(warnings).toContain('правок перезаписано новее с другого устройства: 1')
    expect((await getMeta('merge_conflicts', db))[0]).toMatchObject({
      id: 'w1', winner: 'server', base: T1, server: T3, local: T2,
    })
    const left = await db.outbox.toArray()
    expect(left.map((o) => [o.workoutId, o.type]).sort()).toEqual([['other', 'upsert'], ['w1', 'delete']])
  })

  it('конфликт в пользу локальной: очередь цела, правка уедет push-ом, проигравшая все равно в журнале', async () => {
    await seed(localWorkout('w1', { _dirty: 1, _base_updated_at: T1, updated_at: T3 }))
    await db.outbox.add({ workoutId: 'w1', type: 'upsert', attempts: 0 })
    delta(row('w1', { updated_at: T2 }))

    const warnings = await pull(userId, new Set(), db)

    expect(await weightOf('w1')).toBe(50)
    expect(await db.outbox.count()).toBe(1)
    expect(warnings).toContain('правок перезаписано новее с другого устройства: 1')
    expect((await getMeta('merge_conflicts', db))[0]).toMatchObject({ winner: 'local', server: T2, local: T3 })
  })

  it('равное время и правка без updated_at: сервер, журнал без дыр', async () => {
    await seed(
      localWorkout('tie', { _dirty: 1, _base_updated_at: T1, updated_at: T3 }),
      localWorkout('noclock', { _dirty: 1, _base_updated_at: T1, updated_at: undefined }),
    )
    delta(row('tie', { updated_at: T3 }), row('noclock', { updated_at: T2 }))

    await pull(userId, new Set(), db)

    const log = await getMeta('merge_conflicts', db)
    expect(log.find((c) => c.id === 'tie').winner).toBe('server')
    expect(log.find((c) => c.id === 'noclock')).toMatchObject({ winner: 'server', local: null })
  })

  it('журнал держит последние 50 конфликтов', async () => {
    await setMeta('merge_conflicts', Array.from({ length: 50 }, (_, i) => ({ id: `old${i}` })), db)
    await seed(localWorkout('w1', { _dirty: 1, _base_updated_at: T1, updated_at: T2 }))
    delta(row('w1', { updated_at: T3 }))

    await pull(userId, new Set(), db)

    const log = await getMeta('merge_conflicts', db)
    expect(log).toHaveLength(50)
    expect(log[0].id).toBe('old1')
    expect(log[49].id).toBe('w1')
  })

  it('сбой записи журнала не роняет прогон: предупреждение остается, правка принята', async () => {
    await seed(localWorkout('w1', { _dirty: 1, _base_updated_at: T1, updated_at: T2 }))
    delta(row('w1', { updated_at: T3 }))
    const get = db.meta.get.bind(db.meta)
    vi.spyOn(db.meta, 'get').mockImplementation((key) => (key === 'merge_conflicts' ? Promise.reject(new Error('quota')) : get(key)))

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toContain('правок перезаписано новее с другого устройства: 1')
    expect(await weightOf('w1')).toBe(100)
  })

  it('watermark шагает и через строку, оставленную ради локальной правки', async () => {
    await seed(localWorkout('w1', { _dirty: 1, _base_updated_at: T3 }))
    delta(row('w1', { updated_at: T3 }))

    await pull(userId, new Set(), db)

    expect(await weightOf('w1')).toBe(50)
    expect(await getMeta('wm_workouts', db)).toBe(T3)
  })

  it('watermark назад не идет: строка старше метки его не сдвигает', async () => {
    await setMeta('wm_workouts', T3, db)
    delta(row('w1', { updated_at: T2 }))

    await pull(userId, new Set(), db)

    expect(server.calls.find(isDelta).gt).toEqual({ key: 'updated_at', value: T3 })
    expect(await getMeta('wm_workouts', db)).toBe(T3)
  })
})

describe('правка во время сетевого запроса', () => {
  it('тренировку поправили, пока ехала дельта: грязная версия остается и без конфликта', async () => {
    await seed(localWorkout('w1', { updated_at: T3 }))
    serve(
      [isDelta, async () => {
        await db.workouts.update('w1', { _dirty: 1, _base_updated_at: T3, entries: [{ exercise_id: 'ex1', sets: [{ weight: 77, reps: 1 }] }] })
        return ok([row('w1', { updated_at: T3 })])
      }],
      [isIds, ok([{ id: 'w1' }])],
    )

    await pull(userId, new Set(), db)

    expect(await weightOf('w1')).toBe(77)
    expect((await db.workouts.get('w1'))._dirty).toBe(1)
    expect(await getMeta('merge_conflicts', db)).toBeUndefined()
  })

  it('новая тренировка записана, пока шел запрос: сверка удалений ее не считает пропавшей', async () => {
    serve(
      [isDelta, async () => { await seed(localWorkout('new', { _dirty: 1 })); return ok([]) }],
      [isIds, ok([{ id: 'other' }])],
      [isHeal, ok([])],
    )

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.workouts.get('new')).toBeTruthy()
    expect(await getMeta('pending_workout_deletes', db)).toEqual([])
  })
})

describe('самолечение: дотягивание по id', () => {
  const missing = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }))

  it('длинный список идет пачками по 100', async () => {
    serve(
      [isIds, ok(missing(150))],
      [isHeal, (c) => ok(c.in.map((id) => row(id, { updated_at: T1 })))],
    )

    const warnings = await pull(userId, new Set(), db, VERIFIED)

    expect(server.calls.filter(isHeal).map((c) => c.in.length)).toEqual([100, 50])
    expect(await db.workouts.count()).toBe(150)
    expect(warnings).toEqual([])
    expect(await getMeta('wm_workouts', db)).toBeUndefined() // дотянутое старше метки — метка стоит
  })

  it.each([
    ['ошибка', () => fail('heal timeout')],
    ['сеть', () => { throw new Error('heal timeout') }],
  ])('сбой второй пачки (%s): первая принята, дальше не идем, предупреждение', async (_name, second) => {
    await setMeta('wm_workouts', T3, db)
    let n = 0
    serve(
      [isIds, ok(missing(250))],
      [isHeal, (c) => { n += 1; return n === 1 ? ok(c.in.map((id) => row(id, { updated_at: T1 }))) : second() }],
    )

    const warnings = await pull(userId, new Set(), db, VERIFIED)

    expect(warnings).toContain('история не дотянута: heal timeout')
    expect(n).toBe(2)
    expect(await db.workouts.count()).toBe(100)
    expect(await getMeta('wm_workouts', db)).toBe(T3)
  })

  it('запись появилась локально, пока шел запрос: своя правка не перезаписывается', async () => {
    serve(
      [isIds, ok([{ id: 'w1' }])],
      [isHeal, async (c) => { await seed(localWorkout('w1', { _dirty: 1 })); return ok(c.in.map((id) => row(id))) }],
    )

    await pull(userId, new Set(), db, VERIFIED)

    expect(await weightOf('w1')).toBe(50)
    expect((await db.workouts.get('w1'))._dirty).toBe(1)
  })

  it('пустой ответ дотягивания — тихо, без падения', async () => {
    serve([isIds, ok([{ id: 'w1' }])], [isHeal, { data: null, error: null }])
    expect(await pull(userId, new Set(), db, VERIFIED)).toEqual([])
    expect(await db.workouts.get('w1')).toBeUndefined()
  })
})

describe('перечитывание тренировок после правки упражнения', () => {
  const NEW_NAME = 'Жим штанги'
  const exRow = { id: 'ex1', name: NEW_NAME, updated_at: T2 }

  // Метка справочника уже стоит, упражнение ex1 изменилось с нее, чистая w1 его содержит.
  async function renamedOnServer(heal) {
    await setMeta('wm_exercises', T1, db)
    serve(
      [(c) => c.table === 'exercises' && isProbe(c), ok([{ id: 'ex1', updated_at: T2 }])],
      [isFull('exercises'), ok([exRow])],
      [isIds, ok([{ id: 'w1' }])],
      [isHeal, heal],
    )
  }
  const renamed = (c) => ok(c.in.map((id) => row(id, { updated_at: T1, name: NEW_NAME })))
  const nameOf = async (id) => (await db.workouts.get(id)).entries[0].exercise.name

  it('находит упражнение и по снимку, когда в записи нет exercise_id', async () => {
    await seed(localWorkout('w1', { entries: [{ exercise: { id: 'ex1', name: 'Жим лежа' }, sets: [] }] }))
    await renamedOnServer(renamed)

    await pull(userId, new Set(), db, VERIFIED)

    expect(await nameOf('w1')).toBe(NEW_NAME)
  })

  it('чужие упражнения, запись без состава и тумбстон не перечитываются', async () => {
    await seed(
      localWorkout('w1', { entries: [{ exercise_id: 'other', exercise: { id: 'other' }, sets: [] }] }),
      localWorkout('w2', { entries: undefined }),
      localWorkout('w3', { _deleted: 1 }),
    )
    await renamedOnServer(renamed)

    await pull(userId, new Set(), db, VERIFIED)

    expect(server.calls.filter((c) => isHeal(c) && c.in.includes('w3'))).toEqual([])
    expect((await db.workouts.get('w3')).entries[0].exercise.name).toBe('Жим лежа')
  })

  it('сетевой сбой — предупреждение, снимок прежний, прогон идет дальше', async () => {
    await seed(localWorkout('w1'))
    await renamedOnServer(() => { throw new Error('offline') })

    const warnings = await pull(userId, new Set(), db, VERIFIED)

    expect(warnings).toContain('история не обновлена после правки упражнения: offline')
    expect(await nameOf('w1')).toBe('Жим лежа')
    expect((await db.exercises.get('ex1')).name).toBe(NEW_NAME) // справочник принят
  })

  it('ошибка без message читается, пустой ответ ничего не ломает', async () => {
    await seed(localWorkout('w1'))
    await renamedOnServer({ data: null, error: 'нет прав' })
    expect(await pull(userId, new Set(), db, VERIFIED)).toContain('история не обновлена после правки упражнения: нет прав')

    await db.meta.delete('sig_exercises')
    await setMeta('wm_exercises', T1, db)
    await renamedOnServer({ data: null, error: null })
    expect(await pull(userId, new Set(), db, VERIFIED)).toEqual([])
    expect(await nameOf('w1')).toBe('Жим лежа')
  })

  it('тренировку удалили, пока шло перечитывание, — она не воскресает', async () => {
    await seed(localWorkout('w1'))
    await renamedOnServer(async (c) => { await db.workouts.delete('w1'); return renamed(c) })

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.workouts.get('w1')).toBeUndefined()
  })

  it('версия успела смениться без пометки dirty (pull/push другого шага) — свежая остается', async () => {
    await seed(localWorkout('w1'))
    await renamedOnServer(async (c) => { await db.workouts.update('w1', { updated_at: T3 }); return renamed(c) })

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.workouts.get('w1')).toMatchObject({ updated_at: T3 })
    expect(await nameOf('w1')).toBe('Жим лежа')
  })

  it('первый прогон (метки справочника нет) ничего не перечитывает: тренировки приедут сами', async () => {
    await seed(localWorkout('w1'))
    serve([isFull('exercises'), ok([exRow])], [isIds, ok([{ id: 'w1' }])])

    await pull(userId, new Set(), db, VERIFIED)

    expect(server.calls.filter(isHeal)).toEqual([])
  })

  it('упражнение без updated_at и не менявшееся — не повод перечитывать', async () => {
    await seed(localWorkout('w1'))
    await setMeta('wm_exercises', T2, db)
    serve([isFull('exercises'), ok([{ id: 'ex1', name: 'Жим' }, { id: 'ex2', name: 'Тяга', updated_at: T1 }])], [isIds, ok([{ id: 'w1' }])])

    await pull(userId, new Set(), db, VERIFIED)

    expect(server.calls.filter(isHeal)).toEqual([])
  })
})

describe('справочник: что не теряется при полной замене', () => {
  const probe = (c) => c.table === 'exercises' && isProbe(c)

  it('свое новое упражнение, которого сервер еще не знает, переживает замену (даже пустым ответом)', async () => {
    await db.exercises.put({ id: 'mine', name: 'Свое', _dirty: 1 })
    await db.ex_outbox.add({ exerciseId: 'mine', createdAt: T3 })

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.exercises.get('mine')).toMatchObject({ name: 'Свое', _dirty: 1 })
    expect(await db.ex_outbox.count()).toBe(1)
  })

  it('мертвая операция снимается только у принятого упражнения, чужая очередь цела', async () => {
    await db.exercises.bulkPut([
      { id: 'known', name: 'Локальная', _dirty: 1 },
      { id: 'mine', name: 'Новое', _dirty: 1 },
    ])
    await db.ex_outbox.bulkAdd([
      { exerciseId: 'known', _dead: 1 },
      { exerciseId: 'mine', createdAt: T3 },
    ])
    serve([isFull('exercises'), ok([{ id: 'known', name: 'Серверная', updated_at: T2 }])])

    await pull(userId, new Set(), db)

    expect((await db.exercises.get('known')).name).toBe('Серверная')
    expect((await db.ex_outbox.toArray()).map((o) => o.exerciseId)).toEqual(['mine'])
  })

  it('ответ без данных и без ошибки: справочник и метки не трогаем', async () => {
    await db.exercises.put({ id: 'ex1', name: 'Жим' })
    await setMeta('sig_exercises', 'старая', db)
    serve([isFull('exercises'), { data: null, error: null }])

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.exercises.get('ex1')).toBeTruthy()
    expect(await getMeta('sig_exercises', db)).toBe('старая')
  })

  it('упала проба — полная выборка все равно идет и метки ставятся по принятому', async () => {
    serve([probe, fail('probe down')], [isFull('exercises'), ok([{ id: 'ex1', name: 'Жим', updated_at: T2 }])])

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toEqual([])
    expect(await db.exercises.get('ex1')).toBeTruthy()
    expect(await getMeta('wm_exercises', db)).toBe(T2)
    expect(await getMeta('sig_exercises', db)).toBeTruthy()
  })

  it('метка — по принятым строкам; их время пусто — берется время пробы', async () => {
    serve([probe, ok([{ id: 'ex1', updated_at: T3 }])], [isFull('exercises'), ok([{ id: 'ex1', name: 'Жим' }])])
    await pull(userId, new Set(), db)
    expect(await getMeta('wm_exercises', db)).toBe(T3)
  })

  it('справочник стал новее метки при том же наборе — перекачивается', async () => {
    await setMeta('wm_exercises', T1, db)
    await setMeta('sig_exercises', JSON.stringify([['ex1'], T1]), db)
    serve([probe, ok([{ id: 'ex1', updated_at: T2 }])], [isFull('exercises'), ok([{ id: 'ex1', name: 'Новое', updated_at: T2 }])])

    await pull(userId, new Set(), db)

    expect((await db.exercises.get('ex1')).name).toBe('Новое')
  })
})

describe('ростер: сбой пробы', () => {
  const probe = (c) => c.table === 'login_users' && isProbe(c)
  const rows = [{ id: 'r1', name: 'Дима', avatar_url: null, sort_order: 1, sex: 'm' }]

  it('проба упала: ростер перекачан, но сигнатура не запомнена — следующий прогон проверит снова', async () => {
    serve([probe, fail('probe down')], [isFull('login_users'), ok(rows)])

    await pull(userId, new Set(), db)

    expect((await loginDb.users.get('r1')).sex).toBe('m')
    expect(await getLoginMeta('sig_login_users')).toBeUndefined()
  })

  it('упали и проба, и выборка: кэш цел, предупреждение', async () => {
    await loginDb.users.put({ id: 'r1', name: 'Дима', sex: 'm' })
    serve([(c) => c.table === 'login_users', fail('roster down')])

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toContain('пользователи: roster down')
    expect((await loginDb.users.get('r1')).sex).toBe('m')
  })
})

describe('шаблоны: края реконсиляции', () => {
  const probe = (c) => c.table === 'workout_templates' && isProbe(c)
  const full = isFull('workout_templates')
  const srv = (id, patch = {}) => ({ id, user_id: userId, name: 'С сервера', updated_at: T2, template_exercises: [], ...patch })

  it('проба упала: окно перекачано, старая сигнатура не заменена', async () => {
    await setMeta('sig_templates_v2', 'старая', db)
    serve([probe, fail('probe down')], [full, ok([srv('tpl')])])

    await pull(userId, new Set(), db)

    expect(await db.templates.get('tpl')).toBeTruthy()
    expect(await getMeta('sig_templates_v2', db)).toBe('старая')
  })

  it('упала выборка: шаблоны целы, сигнатура не двигается — повторим', async () => {
    await db.templates.put(localTemplate('tpl'))
    serve([probe, ok([{ id: 'tpl', updated_at: T2 }])], [full, fail('tpl down')])

    const warnings = await pull(userId, new Set(), db, VERIFIED)

    expect(warnings).toContain('шаблоны: tpl down')
    expect(await db.templates.get('tpl')).toBeTruthy()
    expect(await getMeta('sig_templates_v2', db)).toBeUndefined()
  })

  it('42703 не про target_plan — обычная ошибка, а не «старый сервер»', async () => {
    await db.templates.put(localTemplate('tpl'))
    serve([full, { data: null, error: { code: '42703', message: 'column foo does not exist' } }])

    const warnings = await pull(userId, new Set(), db, VERIFIED)

    expect(warnings).toContain('шаблоны: column foo does not exist')
    expect(server.calls.filter(full)).toHaveLength(1)
    expect(await db.templates.get('tpl')).toBeTruthy()
  })

  it('42703 без текста — тоже обычная ошибка', async () => {
    serve([full, { data: null, error: { code: '42703' } }])
    const warnings = await pull(userId, new Set(), db, VERIFIED)
    expect(warnings.some((w) => w.startsWith('шаблоны: '))).toBe(true)
  })

  it('ответ без данных и без ошибки: ничего не удаляем', async () => {
    await db.templates.put(localTemplate('tpl'))
    serve([full, { data: null, error: null }])

    await pull(userId, new Set(), db, VERIFIED)

    expect(await db.templates.get('tpl')).toBeTruthy()
  })

  it('пустое окно без личности бережет и чужой общий шаблон', async () => {
    await db.templates.put(localTemplate('shared', { user_id: 'friend', is_public: 1 }))

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toContain('шаблоны: сервер вернул пустой список')
    expect(await db.templates.get('shared')).toBeTruthy()
  })

  it('пустое окно: грязный и удаленный локально не считаются потерей, предупреждения нет', async () => {
    await db.templates.bulkPut([
      localTemplate('dirty', { _dirty: 1 }),
      localTemplate('tomb', { _deleted: 1 }),
      localTemplate('hidden', { user_id: 'friend', is_public: 0 }),
    ])

    const warnings = await pull(userId, new Set(), db)

    expect(warnings).toEqual([])
    expect(await db.templates.count()).toBe(3)
  })

  it('чужой общий, ставший приватным, уходит; чужой вне окна и свой грязный остаются', async () => {
    await db.templates.bulkPut([
      localTemplate('shared', { user_id: 'friend', is_public: 1 }),
      localTemplate('outside', { user_id: 'friend', is_public: 0 }),
      localTemplate('mine', { _dirty: 1 }),
      localTemplate('tomb', { _deleted: 1 }),
    ])
    serve([full, ok([srv('tpl')])])

    await pull(userId, new Set(), db)

    expect(await db.templates.get('shared')).toBeUndefined()
    expect(await db.templates.get('outside')).toBeTruthy()
    expect(await db.templates.get('mine')).toBeTruthy()
    expect(await db.templates.get('tomb')).toBeTruthy()
  })

  it('грязный без живой операции: берем серверный и чистим только его очередь', async () => {
    await db.templates.bulkPut([localTemplate('tpl', { _dirty: 1, name: 'Локальный' }), localTemplate('alive', { _dirty: 1 })])
    await db.tpl_outbox.bulkAdd([
      { templateId: 'tpl', type: 'upsert', attempts: 5, _dead: 1 },
      { templateId: 'alive', type: 'upsert', attempts: 0 },
    ])
    serve([full, ok([srv('tpl')])])

    await pull(userId, new Set(), db)

    expect(await db.templates.get('tpl')).toMatchObject({ name: 'С сервера', _dirty: 0 })
    expect((await db.tpl_outbox.toArray()).map((o) => o.templateId)).toEqual(['alive'])
  })

  it('локальный тумбстон с серверной строкой не воскресает', async () => {
    await db.templates.put(localTemplate('tpl', { _deleted: 1, _dirty: 1 }))
    await db.tpl_outbox.add({ templateId: 'tpl', type: 'delete', attempts: 0 })
    serve([full, ok([srv('tpl')])])

    await pull(userId, new Set(), db)

    expect((await db.templates.get('tpl'))._deleted).toBe(1)
    expect(await db.tpl_outbox.count()).toBe(1)
  })
})

describe('pullGoal: края', () => {
  const goals = (rows) => serve([(c) => c.table === 'goals', ok(rows)])
  const local = (patch) => ({ exerciseId: 'ex1', exerciseName: 'Жим', metric: 'weight', targetWeight: 100, targetReps: null, achievedAt: null, _dirty: 0, ...patch })

  it('оба варианта выборки упали: локальные цели целы', async () => {
    const before = [local({ achievedAt: T2 })]
    await writeGoals(userId, before, db)
    serve([(c) => c.table === 'goals', fail('goals down')])

    await pullGoal(userId, db)

    expect(server.calls.filter((c) => c.table === 'goals')).toHaveLength(2)
    expect(await readGoals(userId, db)).toEqual(before)
  })

  it('метрика и имя: упражнения нет в справочнике — остаются локальные', async () => {
    await writeGoals(userId, [local({ exerciseName: 'Планка', metric: 'time' })], db)
    goals([{ exercise_id: 'ex1', target_weight: 60, achieved_at: null }])

    await pullGoal(userId, db)

    expect((await readGoals(userId, db))[0]).toMatchObject({ exerciseName: 'Планка', metric: 'time', targetWeight: 60 })
  })

  it('ничего не известно об упражнении — заглушка и весовая метрика', async () => {
    goals([{ exercise_id: 'x', target_weight: 60, achieved_at: null }])

    await pullGoal(userId, db)

    expect((await readGoals(userId, db))[0]).toMatchObject({ exerciseName: '—', metric: 'weight' })
  })

  it('метрика с сервера важнее справочника', async () => {
    await db.exercises.put({ id: 'ex1', name: 'Подтягивания', metric: 'weight' })
    goals([{ exercise_id: 'ex1', target_weight: 15, metric: 'reps', achieved_at: null }])

    await pullGoal(userId, db)

    expect((await readGoals(userId, db))[0].metric).toBe('reps')
  })

  it('повторы цели: округляются, ноль и мусор — «без повторов»', async () => {
    goals([
      { exercise_id: 'a', target_weight: 100, target_reps: 8.4, achieved_at: null },
      { exercise_id: 'b', target_weight: 100, target_reps: 0, achieved_at: null },
      { exercise_id: 'c', target_weight: 100, target_reps: null, achieved_at: null },
    ])

    await pullGoal(userId, db)

    expect((await readGoals(userId, db)).map((g) => g.targetReps)).toEqual([8, null, null])
  })

  it('серверная отметка достижения важнее локальной, локальная не стирается пустой', async () => {
    await writeGoals(userId, [local({ exerciseId: 'a', achievedAt: T1 }), local({ exerciseId: 'b', achievedAt: T1 })], db)
    goals([
      { exercise_id: 'a', target_weight: 100, achieved_at: T2 },
      { exercise_id: 'b', target_weight: 100, achieved_at: null },
    ])

    await pullGoal(userId, db)

    expect((await readGoals(userId, db)).map((g) => g.achievedAt)).toEqual([T2, T1])
  })

  it('тот же состав в другом порядке — записи нет', async () => {
    const before = [local({ exerciseId: 'b' }), local({ exerciseId: 'a', exerciseName: undefined })]
    await writeGoals(userId, before, db)
    await db.exercises.put({ id: 'a', name: '—' })
    await db.exercises.put({ id: 'b', name: 'Жим' })
    goals([
      { exercise_id: 'a', target_weight: 100, achieved_at: null },
      { exercise_id: 'b', target_weight: 100, achieved_at: null },
    ])

    await pullGoal(userId, db)

    expect((await readGoals(userId, db)).map((g) => g.exerciseId)).toEqual(['b', 'a'])
  })

  it('цель убрали на другом устройстве (личность подтверждена) — уходит и здесь', async () => {
    await writeGoals(userId, [local()], db)
    goals([])

    await pullGoal(userId, db)

    expect(await readGoals(userId, db)).toEqual([])
  })

  it('пустой ответ без подтвержденной личности не стирает цели и локальное достижение', async () => {
    const before = [local({ metric: 'reps', achievedAt: T2 })]
    await writeGoals(userId, before, db)
    goals([])

    await pullGoal(userId, db, { identityVerified: false })

    expect(await readGoals(userId, db)).toEqual(before)
  })
})

describe('pullUserMeta: края', () => {
  it('таблицы нет на сервере: локальное и состояние не тронуты', async () => {
    await setMeta(`fav_${userId}`, ['A'], db)
    serve([(c) => c.table === 'user_meta', fail('relation does not exist')])

    await pullUserMeta(userId, db)

    expect(await getMeta(`fav_${userId}`, db)).toEqual(['A'])
    expect((await getUserMetaState(db)).fav).toMatchObject({ at: '', dirty: 0 })
  })

  it('пустой ответ не считается удалением: значение остается и встает в очередь наверх', async () => {
    await setMeta(`fav_${userId}`, ['A'], db)
    serve([(c) => c.table === 'user_meta', { data: null, error: null }])

    await pullUserMeta(userId, db)

    expect(await getMeta(`fav_${userId}`, db)).toEqual(['A'])
    expect((await getUserMetaState(db)).fav.dirty).toBe(1)
  })

  it('первый pull на новом устройстве: серверное значение принимается без локального состояния', async () => {
    serve([(c) => c.table === 'user_meta', ok([{ key: 'fav', value: ['S'], updated_at: T3 }])])

    await pullUserMeta(userId, db)

    expect(await getMeta(`fav_${userId}`, db)).toEqual(['S'])
    expect((await getUserMetaState(db)).fav).toMatchObject({ dirty: 0, base: T3 })
  })
})
