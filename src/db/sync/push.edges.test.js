// Края стадии PUSH на реальном Dexie (fake-indexeddb) и замоканном Supabase: чем кончается сбой
// каждой очереди (временный — не попытка, ошибка данных — попытка и dead-letter), порядок внутри
// очереди, правка и удаление во время сетевого запроса, ожидание upsert_template_v2, цели и
// user_meta. Основные пути — push.test.js и sync.test.js; здесь ветки с риском тихой потери
// правки или вечной очереди (покрытие веток, 30.10.2026).
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const server = vi.hoisted(() => ({
  calls: [],
  rpc: () => ({ data: null, error: null }),
  from: () => ({ data: null, error: null }),
}))

// Ответ может быть значением, промисом или броском (сетевой сбой, таймаут).
vi.mock('../supabase.js', () => {
  function from(table) {
    return {
      table,
      action: null,
      payload: null,
      filters: {},
      upsert(payload) { this.action = 'upsert'; this.payload = payload; return this },
      delete() { this.action = 'delete'; return this },
      eq(key, value) { this.filters[key] = value; return this },
      match(filters) { Object.assign(this.filters, filters); return this },
      then(ok, fail) {
        const call = { kind: 'from', table, action: this.action, payload: this.payload, filters: this.filters }
        server.calls.push(call)
        return new Promise((resolve) => resolve(server.from(call))).then(ok, fail)
      },
    }
  }
  const rpc = (name, args) => ({
    then(ok, fail) {
      server.calls.push({ kind: 'rpc', name, args })
      return new Promise((resolve) => resolve(server.rpc(name, args))).then(ok, fail)
    },
  })
  return { supabase: { from, rpc } }
})

import { openUserDb, closeUserDb, db, setMeta } from '../local.js'
import { readGoals, writeGoals } from '../notifications.js'
import { getUserMetaState, writeSyncedMeta } from '../userMeta.js'
import { saveTemplate, saveWorkout, updateExercise, deleteWorkout, deleteTemplate, deadLetterCount, retryDeadLetter } from '../repo.js'
import { push, pushExercises, pushGoal, pushReactions, pushTemplates, pushUserMeta, TEMPLATE_WAIT_SERVER } from './push.js'
import { uniqueUserId } from '../../test/idbHarness.js'

const T1 = '2026-07-28T20:00:00.000Z'
const T2 = '2026-07-28T20:05:00.000Z'
const MAX_ATTEMPTS = 5

let userId

// Один ответ на все каналы: у трех очередей разные (rpc, from), а исход должен быть один.
const answer = (fn) => { server.rpc = fn; server.from = fn }
const success = () => ({ data: null, error: null })
const refused = (code) => () => ({ data: null, error: { code, message: `отказ ${code}` } })
const sent = () => server.calls.length

const seedWorkout = async (id, patch = {}) => {
  await db.workouts.put({
    id, user_id: userId, performed_at: '2026-07-28', updated_at: T1, _dirty: 1, _deleted: 0,
    entries: [{ exercise_id: 'ex1', sets: [{ weight: 80, reps: 6 }] }], ...patch,
  })
  await db.outbox.add({ workoutId: id, type: 'upsert', createdAt: T1, attempts: 0 })
}
const seedExercise = async (id, patch = {}) => {
  await db.exercises.put({ id, name: `Упр ${id}`, owner_id: userId, is_custom: true, _dirty: 1, ...patch })
  await db.ex_outbox.add({ exerciseId: id, createdAt: T1, attempts: 0 })
}
const seedTemplate = async (id, patch = {}) => {
  await db.templates.put({
    id, user_id: userId, name: 'План', is_public: 0, updated_at: T1, exercises: [], _dirty: 1, _deleted: 0, ...patch,
  })
  await db.tpl_outbox.add({ templateId: id, type: 'upsert', createdAt: T1, attempts: 0 })
}

// Три очереди с общей политикой повторов: таблица очереди, документ, засев и прогон.
const QUEUES = [
  ['тренировки', 'outbox', 'workouts', seedWorkout, () => push(db)],
  ['упражнения', 'ex_outbox', 'exercises', seedExercise, () => pushExercises(db)],
  ['шаблоны', 'tpl_outbox', 'templates', seedTemplate, () => pushTemplates(db)],
]

const TRANSIENT = [
  ['таймаут клиента', () => { throw new Error('Превышено время ожидания сети. Проверь связь и попробуй еще раз.') }],
  ['обрыв запроса (AbortError)', () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }],
  ['нет сети', () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } })],
  ['5xx шлюза без кода', () => ({ data: null, error: { message: '<html>502 Bad Gateway</html>', code: '' } })],
  ['протухший JWT', () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } })],
  ['statement timeout', () => ({ data: null, error: { code: '57014', message: 'canceling statement' } })],
]

beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  server.calls.length = 0
  answer(success)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await closeUserDb()
})

describe.each(QUEUES)('очередь «%s»: политика повторов', (_title, queue, docs, seed, run) => {
  it.each(TRANSIENT)('%s: шесть провалов — ни попытки, ни dead-letter, проход обрывается', async (_n, fail) => {
    await seed('a')
    await seed('b')
    answer(fail)

    for (let i = 0; i < 6; i++) await expect(run()).rejects.toBeDefined()

    const [first, second] = await db[queue].orderBy('seq').toArray()
    expect(first).toMatchObject({ attempts: 0 })
    expect(first._dead).toBeFalsy()
    expect(first.lastError).toBeTruthy()
    // Порядок: следующая операция ни разу не ушла и не несет следов попытки.
    expect(second.lastError).toBeUndefined()
    expect(sent()).toBe(6)
    expect((await db[docs].get('a'))._dirty).toBe(1)
  })

  it('ошибка данных: попытка растет, проход обрывается, документ остается dirty', async () => {
    await seed('a')
    await seed('b')
    answer(refused('23503'))

    await expect(run()).rejects.toMatchObject({ code: '23503' })
    await expect(run()).rejects.toMatchObject({ code: '23503' })

    const [first] = await db[queue].orderBy('seq').toArray()
    expect(first).toMatchObject({ attempts: 2, lastError: 'отказ 23503' })
    expect(first._dead).toBeFalsy()
    expect(sent()).toBe(2)
    expect((await db[docs].get('a'))._dirty).toBe(1)
  })

  it('пятая ошибка данных: операция мертва, в том же проходе уходит следующая', async () => {
    await seed('a')
    await seed('b')
    answer(refused('23514'))
    for (let i = 1; i < MAX_ATTEMPTS; i++) await expect(run()).rejects.toBeDefined()
    expect(await deadLetterCount()).toBe(0)

    server.from = (call) => (call.payload?.id === 'a' ? refused('23514')() : success())
    server.rpc = (_name, args) => (args.p_workout_id === 'a' || args.p_template_id === 'a' ? refused('23514')() : success())
    await run() // очередь не повешена: мертвая операция не бросает

    const ops = await db[queue].toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ _dead: 1, attempts: MAX_ATTEMPTS })
    expect(await deadLetterCount()).toBe(1)
    expect((await db[docs].get('a'))._dirty).toBe(1) // правка на месте, ждет разбора
    expect((await db[docs].get('b'))._dirty).toBe(0)
  })

  it('мертвая операция больше не отправляется, а retryDeadLetter возвращает ее в строй', async () => {
    await seed('a')
    await db[queue].toCollection().modify({ _dead: 1, attempts: MAX_ATTEMPTS })

    await run()
    expect(sent()).toBe(0)
    expect(await db[queue].count()).toBe(1)

    expect(await retryDeadLetter()).toBe(1)
    await run()
    expect(sent()).toBe(1)
    expect(await db[queue].count()).toBe(0)
    expect((await db[docs].get('a'))._dirty).toBe(0)
  })
})

describe('новая правка воскрешает мертвую операцию (до сервера доезжает)', () => {
  const entries = [{ exercise: { id: 'ex1', name: 'Жим' }, sets: [{ weight: 90, reps: 5 }] }]

  it('тренировка: новая правка уезжает, очередь и dead-letter пусты', async () => {
    await seedWorkout('w1')
    await db.outbox.toCollection().modify({ _dead: 1, attempts: MAX_ATTEMPTS, lastError: 'старая' })

    await saveWorkout({ id: 'w1', user_id: userId, entries })
    await push(db)

    expect(server.calls.at(-1).args.p_entries[0].sets).toEqual([{ weight: 90, reps: 5 }])
    expect(await db.outbox.count()).toBe(0)
    expect(await deadLetterCount()).toBe(0)
    expect((await db.workouts.get('w1'))._dirty).toBe(0)
  })

  it('шаблон: то же', async () => {
    await seedTemplate('t1')
    await db.tpl_outbox.toCollection().modify({ _dead: 1, attempts: MAX_ATTEMPTS })

    await saveTemplate({ id: 't1', user_id: userId, name: 'Новое имя', exercises: [{ exercise: { id: 'ex1', name: 'Жим' } }] })
    await pushTemplates(db)

    expect(server.calls.at(-1).args.p_name).toBe('Новое имя')
    expect(await db.tpl_outbox.count()).toBe(0)
    expect((await db.templates.get('t1'))._dirty).toBe(0)
  })

  it('упражнение: при мертвой операции правка ставит живую, она и уезжает', async () => {
    await seedExercise('e1')
    await db.ex_outbox.toCollection().modify({ _dead: 1, attempts: MAX_ATTEMPTS })

    await updateExercise({ id: 'e1', name: 'Новое', editor_id: userId })
    await pushExercises(db)

    expect(server.calls.at(-1).payload.name).toBe('Новое')
    expect((await db.exercises.get('e1'))._dirty).toBe(0)
  })
})

describe('порядок внутри очереди', () => {
  it('уходит по seq; первая временная ошибка оставляет вторую и третью на месте', async () => {
    await seedWorkout('a')
    await seedWorkout('b')
    await seedWorkout('c')
    server.rpc = (_name, args) => (args.p_workout_id === 'b'
      ? { data: null, error: { message: 'Failed to fetch' } }
      : success())

    await expect(push(db)).rejects.toBeDefined()

    expect(server.calls.map((c) => c.args.p_workout_id)).toEqual(['a', 'b'])
    expect((await db.outbox.orderBy('seq').toArray()).map((o) => o.workoutId)).toEqual(['b', 'c'])
    expect((await db.workouts.get('a'))._dirty).toBe(0)
  })
})

describe('pushExercises: края', () => {
  it('документа нет — операция снимается без запроса', async () => {
    await db.ex_outbox.add({ exerciseId: 'нет', createdAt: T1 })
    await pushExercises(db)
    expect(sent()).toBe(0)
    expect(await db.ex_outbox.count()).toBe(0)
  })

  it('легаси-строка без группы и владельца уходит null-ами, а не присваивается', async () => {
    await db.exercises.put({ id: 'old', name: 'Старое', is_custom: true, _dirty: 1 })
    await db.ex_outbox.add({ exerciseId: 'old', createdAt: T1 })

    await pushExercises(db)

    expect(server.calls[0].payload).toEqual({
      id: 'old', name: 'Старое', muscle_group: null, submuscle: null, secondary: [],
      is_custom: true, is_bench_lift: false, metric: 'weight', owner_id: null,
    })
  })

  it('строку убрали, пока шел upsert: операция снята, строка не воскресла', async () => {
    await seedExercise('e1')
    server.from = async () => { await db.exercises.delete('e1'); return success() }

    await pushExercises(db)

    expect(await db.exercises.get('e1')).toBeUndefined()
    expect(await db.ex_outbox.count()).toBe(0)
  })

  it('поменялось поле вне снимка (_dirty/служебное) — это не правка, операция снимается', async () => {
    await seedExercise('e1')
    server.from = async () => { await db.exercises.update('e1', { unit: 'lb' }); return success() }

    await pushExercises(db)

    expect(await db.exercises.get('e1')).toMatchObject({ _dirty: 0, unit: 'lb' })
    expect(await db.ex_outbox.count()).toBe(0)
  })
})

describe('pushTemplates: края', () => {
  it('документа нет или он tombstone — upsert снимается без запроса, delete не тронут', async () => {
    await db.tpl_outbox.add({ templateId: 'нет', type: 'upsert', createdAt: T1 })
    await seedTemplate('t1', { _deleted: 1 })

    expect(await pushTemplates(db)).toEqual([])

    expect(sent()).toBe(0)
    expect(await db.tpl_outbox.count()).toBe(0)
    expect((await db.templates.get('t1'))._deleted).toBe(1)
  })

  it('шаблон без списка упражнений уходит старым RPC с пустым массивом', async () => {
    await seedTemplate('t1', { exercises: undefined })
    await pushTemplates(db)
    expect(server.calls[0]).toMatchObject({ name: 'upsert_template', args: { p_exercise_ids: [], p_is_public: false } })
  })

  it('порядок по position (без него — в начало), разминка уходит, основная часть — без поля', async () => {
    await seedTemplate('t1', {
      exercises: [
        { exercise_id: 'b', position: 1, sets: 1, reps: 1, weight: 1, phase: 'cooldown' },
        { exercise_id: 'c', position: 2, phase: 'main' },
        { exercise_id: 'a', sets: 2 },
      ],
    })

    await pushTemplates(db)

    const list = server.calls[0].args.p_exercise_ids
    expect(list.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(list[1].phase).toBe('cooldown')
    expect(list[0]).toEqual({ id: 'a', sets: 2, reps: null, weight: null })
    expect('phase' in list[2]).toBe(false)
    expect('plan' in list[0]).toBe(false)
  })

  it('детальный шаблон: метрика берется из снимка упражнения, строка без плана получает свой', async () => {
    await seedTemplate('t1', {
      exercises: [
        { exercise_id: 'a', exercise: { id: 'a', metric: 'reps' }, set_plan: [{ weight: 0, reps: 12 }] },
        { exercise_id: 'b', position: 1, exercise: { id: 'b', metric: 'weight' }, sets: 2, reps: 5, weight: 40 },
      ],
    })

    await pushTemplates(db)

    expect(server.calls[0].name).toBe('upsert_template_v2')
    const [a, b] = server.calls[0].args.p_exercise_ids
    expect(a.plan).toEqual({ metric: 'reps', sets: [{ weight: 0, reps: 12 }] })
    expect(b.plan).toEqual({ metric: 'weight', sets: [{ weight: 40, reps: 5 }, { weight: 40, reps: 5 }] })
  })

  it.each(['PGRST202', '42883'])('нет upsert_template_v2 (%s): операция жива без попытки, остальные ушли', async (code) => {
    await seedTemplate('plan', { exercises: [{ exercise_id: 'a', set_plan: [{ weight: 20, reps: 5 }] }] })
    await seedTemplate('plain')
    server.rpc = (name) => (name === 'upsert_template_v2' ? refused(code)() : success())

    expect(await pushTemplates(db)).toEqual([TEMPLATE_WAIT_SERVER])

    const ops = await db.tpl_outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ templateId: 'plan', attempts: 0, lastError: TEMPLATE_WAIT_SERVER })
    expect(ops[0]._dead).toBeFalsy()
    expect((await db.templates.get('plan'))._dirty).toBe(1)
    expect((await db.templates.get('plain'))._dirty).toBe(0)
  })

  it('другой отказ v2 — обычная попытка, а не ожидание сервера', async () => {
    await seedTemplate('plan', { exercises: [{ exercise_id: 'a', set_plan: [{ weight: 20, reps: 5 }] }] })
    server.rpc = refused('23514')

    await expect(pushTemplates(db)).rejects.toMatchObject({ code: '23514' })

    expect((await db.tpl_outbox.toArray())[0]).toMatchObject({ attempts: 1, lastError: 'отказ 23514' })
  })

  it('нет старого RPC у простого шаблона — не ожидание, а обычная попытка', async () => {
    await seedTemplate('plain')
    server.rpc = refused('PGRST202')

    await expect(pushTemplates(db)).rejects.toMatchObject({ code: 'PGRST202' })

    expect((await db.tpl_outbox.toArray())[0].attempts).toBe(1)
  })

  it('удалили, пока шел upsert: tombstone цел, его delete доезжает следующим прогоном', async () => {
    await seedTemplate('t1')
    server.rpc = async () => { await deleteTemplate('t1'); return success() }

    await pushTemplates(db)

    expect(await db.templates.get('t1')).toMatchObject({ _deleted: 1 })
    const ops = await db.tpl_outbox.toArray()
    expect(ops.map((o) => o.type)).toEqual(['delete'])

    await pushTemplates(db)
    expect(server.calls.at(-1)).toMatchObject({ table: 'workout_templates', action: 'delete', filters: { id: 't1' } })
    expect(await db.templates.get('t1')).toBeUndefined()
    expect(await db.tpl_outbox.count()).toBe(0)
  })

  it('шаблон исчез, пока шел upsert: операция снята', async () => {
    await seedTemplate('t1')
    server.rpc = async () => { await db.templates.delete('t1'); return success() }

    await pushTemplates(db)

    expect(await db.templates.get('t1')).toBeUndefined()
    expect(await db.tpl_outbox.count()).toBe(0)
  })

  it('сбой серверного delete: tombstone и операция остаются', async () => {
    await seedTemplate('t1', { _deleted: 1, _dirty: 0 })
    await db.tpl_outbox.clear()
    await db.tpl_outbox.add({ templateId: 't1', type: 'delete', createdAt: T1, attempts: 0 })
    server.from = refused('42501')

    await expect(pushTemplates(db)).rejects.toMatchObject({ code: '42501' })

    expect(await db.templates.get('t1')).toMatchObject({ _deleted: 1 })
    expect((await db.tpl_outbox.toArray())[0]).toMatchObject({ type: 'delete', attempts: 1 })
  })

  it('пересоздали, пока шел delete: новая версия не теряется', async () => {
    await seedTemplate('t1', { _deleted: 1, _dirty: 0 })
    await db.tpl_outbox.clear()
    await db.tpl_outbox.add({ templateId: 't1', type: 'delete', createdAt: T1, attempts: 0 })
    server.from = async () => {
      await saveTemplate({ id: 't1', user_id: userId, name: 'Снова', exercises: [{ exercise: { id: 'ex1', name: 'Жим' } }] })
      return success()
    }

    await pushTemplates(db)

    expect(await db.templates.get('t1')).toMatchObject({ name: 'Снова', _dirty: 1, _deleted: 0 })
    expect((await db.tpl_outbox.toArray()).map((o) => o.type)).toEqual(['upsert'])
  })
})

describe('push тренировок: края', () => {
  it('документа нет или он tombstone — upsert снимается без запроса и не попадает в justPushed', async () => {
    await db.outbox.add({ workoutId: 'нет', type: 'upsert', createdAt: T1 })
    await seedWorkout('w1', { _deleted: 1 })

    const just = await push(db)

    expect([...just]).toEqual([])
    expect(sent()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('разминка уходит полем phase, основная часть — без него', async () => {
    await seedWorkout('w1', {
      entries: [
        { exercise_id: 'a', phase: 'warmup', sets: [{ weight: 20, reps: 10 }] },
        { exercise_id: 'b', phase: 'main', sets: [{ weight: 50, reps: 5 }] },
      ],
    })

    await push(db)

    expect(server.calls[0].args.p_entries).toEqual([
      { exercise_id: 'a', sets: [{ weight: 20, reps: 10 }], phase: 'warmup' },
      { exercise_id: 'b', sets: [{ weight: 50, reps: 5 }] },
    ])
  })

  it('отказ второй тренировки не откатывает первую, уже уехавшую', async () => {
    await seedWorkout('ok')
    await seedWorkout('bad')
    server.rpc = (_n, args) => (args.p_workout_id === 'bad' ? refused('23514')() : success())

    await expect(push(db)).rejects.toBeDefined()

    expect((await db.workouts.get('ok'))._dirty).toBe(0)
    expect((await db.workouts.get('bad'))._dirty).toBe(1)
  })

  it('удалили, пока шел upsert: tombstone цел, delete доезжает следующим прогоном', async () => {
    await seedWorkout('w1')
    server.rpc = async () => { await deleteWorkout('w1'); return success() }

    const just = await push(db)

    expect([...just]).toEqual(['w1'])
    expect(await db.workouts.get('w1')).toMatchObject({ _deleted: 1 })
    expect((await db.outbox.toArray()).map((o) => o.type)).toEqual(['delete'])

    await push(db)
    expect(server.calls.at(-1)).toMatchObject({ table: 'workouts', action: 'delete', filters: { id: 'w1' } })
    expect(await db.workouts.get('w1')).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('документ исчез, пока шел upsert: операция снята, документ не воскрес', async () => {
    await seedWorkout('w1')
    server.rpc = async () => { await db.workouts.delete('w1'); return success() }

    await push(db)

    expect(await db.workouts.get('w1')).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('правка в полете доезжает вторым прогоном целиком и снимает _dirty', async () => {
    await seedWorkout('w1', { _base_updated_at: T1 })
    let first = true
    server.rpc = async () => {
      if (first) {
        first = false
        await db.workouts.update('w1', { updated_at: T2, entries: [{ exercise_id: 'ex1', sets: [{ weight: 85, reps: 5 }] }] })
      }
      return success()
    }

    await push(db)
    expect(await db.workouts.get('w1')).toMatchObject({ _dirty: 1, _base_updated_at: null })

    await push(db)
    expect(server.calls.at(-1).args.p_entries[0].sets).toEqual([{ weight: 85, reps: 5 }])
    expect(await db.workouts.get('w1')).toMatchObject({ _dirty: 0, updated_at: T2 })
    expect(await db.outbox.count()).toBe(0)
  })

  it('сбой серверного delete: tombstone и операция остаются', async () => {
    await seedWorkout('w1', { _deleted: 1, _dirty: 0 })
    await db.outbox.clear()
    await db.outbox.add({ workoutId: 'w1', type: 'delete', createdAt: T1, attempts: 0 })
    server.from = refused('42501')

    await expect(push(db)).rejects.toMatchObject({ code: '42501' })

    expect(await db.workouts.get('w1')).toMatchObject({ _deleted: 1 })
    expect((await db.outbox.toArray())[0]).toMatchObject({ type: 'delete', attempts: 1 })
  })

  it('битый документ (нет entries) — ошибка данных: пять попыток, затем dead-letter, очередь идет дальше', async () => {
    await seedWorkout('broken', { entries: undefined })
    await seedWorkout('ok')

    for (let i = 1; i < MAX_ATTEMPTS; i++) await expect(push(db)).rejects.toBeInstanceOf(TypeError)
    expect(await db.workouts.get('ok')).toMatchObject({ _dirty: 1 })

    await push(db)

    expect(await db.workouts.get('ok')).toMatchObject({ _dirty: 0 })
    const ops = await db.outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ workoutId: 'broken', _dead: 1 })
  })

  it('пересоздали, пока шел delete: новая версия не теряется', async () => {
    await seedWorkout('w1', { _deleted: 1, _dirty: 0 })
    await db.outbox.clear()
    await db.outbox.add({ workoutId: 'w1', type: 'delete', createdAt: T1, attempts: 0 })
    const entries = [{ exercise: { id: 'ex1', name: 'Жим' }, sets: [{ weight: 90, reps: 5 }] }]
    server.from = async () => {
      await saveWorkout({ id: 'w1', user_id: userId, entries })
      return success()
    }

    await push(db)

    expect(await db.workouts.get('w1')).toMatchObject({ _dirty: 1, _deleted: 0 })
    expect((await db.outbox.toArray()).map((o) => o.type)).toEqual(['upsert'])
  })
})

describe('pushReactions: низкий приоритет, без dead-letter', () => {
  const seedReactions = () => db.reaction_outbox.bulkAdd([
    { workoutId: 'w1', kind: 'fire', op: 'add', createdAt: T1 },
    { workoutId: 'w2', kind: 'clap', op: 'remove', createdAt: T1 },
  ])

  it.each(TRANSIENT)('%s: попытки нет, следующая реакция все равно отправлена, синк не падает', async (_n, fail) => {
    await seedReactions()
    answer((call) => (call.filters?.workout_id === 'w2' ? success() : fail()))

    await expect(pushReactions(userId, db)).resolves.toBeUndefined()

    const ops = await db.reaction_outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0].workoutId).toBe('w1')
    expect(ops[0].attempts).toBeUndefined()
    expect(ops[0].lastError).toBeTruthy()
  })

  it('ошибка данных копит попытки, не держит очередь, на пятой операция выброшена без _dead', async () => {
    await seedReactions()
    server.from = (call) => (call.action === 'delete' ? success() : refused('23503')())

    await pushReactions(userId, db)
    let [op] = await db.reaction_outbox.toArray()
    expect(op).toMatchObject({ workoutId: 'w1', attempts: 1, lastError: 'отказ 23503' })
    expect(await db.reaction_outbox.count()).toBe(1) // вторая ушла

    for (let i = 2; i < MAX_ATTEMPTS; i++) await pushReactions(userId, db)
    ;[op] = await db.reaction_outbox.toArray()
    expect(op.attempts).toBe(MAX_ATTEMPTS - 1)

    await pushReactions(userId, db)
    expect(await db.reaction_outbox.count()).toBe(0)
  })

  it('отказ снятия реакции считается так же', async () => {
    await db.reaction_outbox.add({ workoutId: 'w1', kind: 'fire', op: 'remove', createdAt: T1 })
    server.from = refused('42501')

    await pushReactions(userId, db)

    expect((await db.reaction_outbox.toArray())[0]).toMatchObject({ attempts: 1 })
  })

  it('брошенная строка попадает в lastError как есть', async () => {
    await db.reaction_outbox.add({ workoutId: 'w1', kind: 'fire', op: 'add', createdAt: T1 })
    server.from = () => { throw 'обрыв' }  

    await pushReactions(userId, db)

    expect((await db.reaction_outbox.toArray())[0].lastError).toBe('обрыв')
  })
})

describe('pushGoal: края', () => {
  const goal = (exerciseId, patch = {}) => ({
    exerciseId, exerciseName: 'Жим', metric: 'weight', targetWeight: 100, achievedAt: null, _dirty: 1, ...patch,
  })

  it('нет грязных — ни запроса; чистые рядом с грязными не отправляются', async () => {
    await writeGoals(userId, [goal('a', { _dirty: 0 })], db)
    await pushGoal(userId, db)
    expect(sent()).toBe(0)

    await writeGoals(userId, [goal('a', { _dirty: 0 }), goal('b')], db)
    await pushGoal(userId, db)
    expect(server.calls.map((c) => c.args.p_exercise_id)).toEqual(['b'])
  })

  it('повторы округляются, 0/пусто → null; неизвестная метрика приводится к weight', async () => {
    await writeGoals(userId, [
      goal('a', { targetReps: 5.6 }),
      goal('b', { targetReps: 0, metric: 'мусор' }),
    ], db)

    await pushGoal(userId, db)

    expect(server.calls[0].args).toMatchObject({ p_target_reps: 6, p_metric: 'weight', p_target_weight: 100 })
    expect(server.calls[1].args.p_target_reps).toBeNull()
  })

  it('ответ-массив: achieved_at сервера записывается в цель', async () => {
    await writeGoals(userId, [goal('a')], db)
    server.rpc = () => ({ data: [{ achieved_at: T2 }], error: null })

    await pushGoal(userId, db)

    expect((await readGoals(userId, db))[0]).toMatchObject({ _dirty: 0, achievedAt: T2 })
  })

  it('достижение, отмеченное локально во время запроса, не стирается пустым ответом', async () => {
    await writeGoals(userId, [goal('a')], db)
    server.rpc = async () => {
      await writeGoals(userId, [goal('a', { achievedAt: T2 })], db)
      return { data: null, error: null }
    }

    await pushGoal(userId, db)

    expect((await readGoals(userId, db))[0]).toMatchObject({ _dirty: 0, achievedAt: T2 })
  })

  it('удаленная во время upsert цель остается tombstone с _dirty', async () => {
    await writeGoals(userId, [goal('a')], db)
    server.rpc = async () => {
      await writeGoals(userId, [goal('a', { _deleted: 1 })], db)
      return success()
    }

    await pushGoal(userId, db)

    expect((await readGoals(userId, db))[0]).toMatchObject({ _deleted: 1, _dirty: 1 })
  })

  it('удаление выкидывает только свою цель; правки соседей за время запроса целы', async () => {
    await writeGoals(userId, [goal('gone', { _deleted: 1 }), goal('stay', { _dirty: 0 })], db)
    server.rpc = async (name) => {
      if (name === 'delete_my_goal') {
        const cur = await readGoals(userId, db)
        await writeGoals(userId, cur.map((g) => (g.exerciseId === 'stay' ? { ...g, targetWeight: 120, _dirty: 1 } : g)), db)
      }
      return success()
    }

    await pushGoal(userId, db)

    expect((await readGoals(userId, db)).map((g) => [g.exerciseId, g.targetWeight])).toEqual([['stay', 120]])
  })

  it('tombstone исчез сам, пока шел delete: ничего не пишем и не падаем', async () => {
    await writeGoals(userId, [goal('a', { _deleted: 1 })], db)
    server.rpc = async () => { await writeGoals(userId, [], db); return success() }

    await pushGoal(userId, db)

    expect(await readGoals(userId, db)).toEqual([])
  })

  it('невалидную цель поправили на валидную, пока отправлялась соседняя: dirty остается', async () => {
    await writeGoals(userId, [goal('ok'), goal('bad', { targetWeight: 0 })], db)
    server.rpc = async (_name, args) => {
      if (args.p_exercise_id === 'ok') await writeGoals(userId, [goal('ok'), goal('bad', { targetWeight: 70 })], db)
      return success()
    }

    await pushGoal(userId, db)

    const goals = await readGoals(userId, db)
    expect(goals.find((g) => g.exerciseId === 'bad')).toMatchObject({ targetWeight: 70, _dirty: 1 })
    expect(goals.find((g) => g.exerciseId === 'ok')._dirty).toBe(0)
    expect(server.calls).toHaveLength(1)
  })

  it('цель без упражнения не отправляется, флаг снимается', async () => {
    await writeGoals(userId, [goal(undefined)], db)
    await pushGoal(userId, db)
    expect(sent()).toBe(0)
    expect((await readGoals(userId, db))[0]._dirty).toBe(0)
  })

  it('сбой: цель остается dirty; ошибка без message в общем тексте — как есть', async () => {
    await writeGoals(userId, [goal('a'), goal('b')], db)
    server.rpc = () => ({ data: null, error: 'строкой' })

    await expect(pushGoal(userId, db)).rejects.toThrow('строкой; строкой')

    expect((await readGoals(userId, db)).map((g) => g._dirty)).toEqual([1, 1])
  })
})

describe('pushUserMeta: края', () => {
  it('нет dirty — ни запроса, ни записи состояния', async () => {
    await setMeta('user_meta_state', { badges: { at: T1, dirty: 0, base: T1 } }, db)

    await pushUserMeta(userId, db)

    expect(sent()).toBe(0)
    expect((await getUserMetaState(db)).badges).toEqual({ at: T1, dirty: 0, base: T1 })
  })

  it('сервер не вернул updated_at: dirty снят, прежний базис не затерт пустым', async () => {
    await writeSyncedMeta(userId, 'badges', { a: { at: T1 } }, db)
    await setMeta('user_meta_state', { badges: { at: T1, dirty: 1, base: T1 } }, db)
    server.rpc = success

    await pushUserMeta(userId, db)

    const st = (await getUserMetaState(db)).badges
    expect(st).toMatchObject({ dirty: 0, base: T1 })
    expect(st.at > T1).toBe(true)
  })

  it('постоянный отказ: значение на месте, dirty остается, ошибка наверх', async () => {
    await writeSyncedMeta(userId, 'badges', { a: { at: T1 } }, db)
    server.rpc = refused('P0001')

    await expect(pushUserMeta(userId, db)).rejects.toMatchObject({ code: 'P0001' })

    expect((await getUserMetaState(db)).badges.dirty).toBe(1)
  })
})
