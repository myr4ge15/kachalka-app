// Слой записи (db/repo.js), куски без тестов до v6.14.2 (замер покрытия 06.10):
// шаблоны и их очередь tpl_outbox, локальное применение админских правок
// упражнений, синкаемые настройки (прогрессия, бейджи), свой пол в ростере,
// недавние сессии для автопрогрессии. Реальный Dexie поверх fake-indexeddb.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db, loginDb, getMeta } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import {
  saveTemplate, deleteTemplate, getTemplates, getTemplate, pendingCount,
  getAllExercisesForAdmin, applyExerciseEditLocal, applyExerciseMergeLocal, getExercises,
  setProgEnabled, getProgSettings, setProgForExercise, writeBadges, getBadges,
  setCachedSex, cacheUsers, getCachedUser, saveWorkout, getRecentSessionsForExercise,
  setWorkoutFeels, retryDeadLetter,
} from './repo.js'
import { getUserMetaState } from './userMeta.js'

const bench = { id: 'ex_bench', name: 'Жим лежа', muscle_group: 'грудь', metric: 'weight', is_bench_lift: true }
const plank = { id: 'ex_plank', name: 'Планка', muscle_group: 'пресс', metric: 'time' }

let userId
beforeEach(async () => { userId = uniqueUserId(); await openUserDb(userId) })
afterEach(async () => { await closeUserDb() })

describe('шаблоны: запись и очередь', () => {
  it('создание: чистит план, пишет _dirty и один upsert в tpl_outbox', async () => {
    const id = await saveTemplate({
      user_id: userId, name: '  Грудь  ', is_public: true,
      exercises: [
        { exercise: bench, sets: '4', reps: 'x', weight: '82.5' },
        { exercise: plank, sets: 0, reps: 60, weight: 20 }, // у времени вес обнуляется
        { exercise: null }, // без упражнения — отсеивается
      ],
    })
    const t = await db.templates.get(id)
    expect(t).toMatchObject({ name: 'Грудь', is_public: 1, _dirty: 1, _deleted: 0 })
    expect(t.exercises).toEqual([
      expect.objectContaining({ exercise_id: 'ex_bench', position: 0, sets: 4, reps: 10, weight: 82.5 }),
      expect.objectContaining({ exercise_id: 'ex_plank', position: 1, sets: 3, reps: 60, weight: 0 }),
    ])
    const ops = await db.tpl_outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ templateId: id, type: 'upsert' })
    expect(await pendingCount()).toBe(1)
  })

  it('без названия или без упражнений — понятная ошибка, ничего не пишется', async () => {
    await expect(saveTemplate({ user_id: userId, name: ' ', exercises: [{ exercise: bench }] })).rejects.toThrow(/название/)
    await expect(saveTemplate({ user_id: userId, name: 'X', exercises: [] })).rejects.toThrow(/упражнение/)
    expect(await db.templates.count()).toBe(0)
  })

  it('правка: created_at сохраняется, upsert не дублируется', async () => {
    const id = await saveTemplate({ user_id: userId, name: 'A', exercises: [{ exercise: bench }] })
    const created = (await db.templates.get(id)).created_at
    await new Promise((r) => setTimeout(r, 5))
    await saveTemplate({ id, user_id: userId, name: 'B', exercises: [{ exercise: plank }] })
    const t = await db.templates.get(id)
    expect(t.name).toBe('B')
    expect(t.created_at).toBe(created)
    expect(await db.tpl_outbox.count()).toBe(1)
  })

  it('удаление: tombstone, upsert заменяется на delete; повторное создание — снова upsert', async () => {
    const id = await saveTemplate({ user_id: userId, name: 'A', exercises: [{ exercise: bench }] })
    await deleteTemplate(id)
    expect(await getTemplate(id)).toBeNull()
    expect((await db.tpl_outbox.toArray()).map((o) => o.type)).toEqual(['delete'])
    await saveTemplate({ id, user_id: userId, name: 'A2', exercises: [{ exercise: bench }] })
    expect((await db.tpl_outbox.toArray()).map((o) => o.type)).toEqual(['upsert'])
    await deleteTemplate('нет-такого') // молча
  })

  it('мертвая операция шаблона оживает от новой правки (не теряется на pull)', async () => {
    const id = await saveTemplate({ user_id: userId, name: 'A', exercises: [{ exercise: bench }] })
    const [op] = await db.tpl_outbox.toArray()
    await db.tpl_outbox.update(op.seq, { _dead: 1, attempts: 5, lastError: 'boom' })
    expect(await pendingCount()).toBe(0)
    await saveTemplate({ id, user_id: userId, name: 'A+', exercises: [{ exercise: bench }] })
    const ops = await db.tpl_outbox.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ _dead: 0, attempts: 0, lastError: null })
    // и retryDeadLetter умеет возвращать мертвые шаблоны
    await db.tpl_outbox.update(ops[0].seq, { _dead: 1 })
    expect(await retryDeadLetter()).toBeGreaterThanOrEqual(1)
    expect(await pendingCount()).toBe(1)
  })

  it('видимость: свои любые + чужие общие, свежие сверху; удаленные скрыты', async () => {
    await db.templates.bulkPut([
      { id: 't1', user_id: userId, name: 'Мой старый', is_public: 0, created_at: '2026-01-01', _deleted: 0 },
      { id: 't2', user_id: userId, name: 'Мой новый', is_public: 0, created_at: '2026-02-01', _deleted: 0 },
      { id: 't3', user_id: 'other', name: 'Чужой общий', is_public: 1, created_at: '2026-01-15', _deleted: 0 },
      { id: 't4', user_id: 'other', name: 'Чужой личный', is_public: 0, created_at: '2026-03-01', _deleted: 0 },
      { id: 't5', user_id: userId, name: 'Удаленный', is_public: 0, created_at: '2026-04-01', _deleted: 1 },
    ])
    expect((await getTemplates(userId)).map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })
})

describe('админские правки упражнений — локально до pull', () => {
  beforeEach(async () => {
    await db.exercises.bulkPut([
      { id: 'b', name: 'Бицепс', muscle_group: 'руки' },
      { id: 'a', name: 'Жим', muscle_group: 'грудь' },
      { id: 'h', name: 'Скрытое', muscle_group: 'грудь', is_hidden: true },
    ])
  })
  it('админ видит и скрытые, пикер — нет; сортировка группа → имя', async () => {
    expect((await getAllExercisesForAdmin()).map((e) => e.id)).toEqual(['a', 'h', 'b'])
    expect((await getExercises()).map((e) => e.id)).toEqual(['a', 'b'])
  })
  it('правка мержится в кэш; несуществующее — молча', async () => {
    await applyExerciseEditLocal('a', { name: 'Жим лёжа', metric: 'weight' })
    expect(await db.exercises.get('a')).toMatchObject({ name: 'Жим лёжа', muscle_group: 'грудь', metric: 'weight' })
    await applyExerciseEditLocal('нет', { name: 'x' })
    expect(await db.exercises.get('нет')).toBeUndefined()
  })
  it('слияние прячет старое упражнение', async () => {
    await applyExerciseMergeLocal('b')
    expect((await db.exercises.get('b')).is_hidden).toBe(true)
    await applyExerciseMergeLocal('нет')
  })
})

describe('синкаемые настройки', () => {
  it('тумблер прогрессии: сохраняет настройки упражнений и помечает dirty', async () => {
    await setProgForExercise(userId, 'ex_bench', { step: 2.5 })
    await setProgEnabled(userId, false)
    expect(await getProgSettings(userId)).toEqual({ enabled: false, byExercise: { ex_bench: expect.objectContaining({ step: 2.5 }) } })
    expect((await getUserMetaState()).prog.dirty).toBe(1)
    await setProgEnabled(userId, true)
    expect((await getProgSettings(userId)).enabled).toBe(true)
  })
  it('по умолчанию прогрессия включена', async () => {
    expect(await getProgSettings(userId)).toEqual({ enabled: true, byExercise: {} })
  })
  it('бейджи пишутся синкаемо; мусор → пустая карта', async () => {
    await writeBadges(userId, { reg_1: { at: '2026-01-01', backfilled: false } })
    expect(await getBadges(userId)).toEqual({ reg_1: { at: '2026-01-01', backfilled: false } })
    expect((await getUserMetaState()).badges.dirty).toBe(1)
    await writeBadges(userId, null)
    expect(await getBadges(userId)).toEqual({})
    expect(await getMeta(`badges_${userId}`)).toEqual({})
  })
})

describe('ростер: свой пол', () => {
  it('мержится в кэш ростера по белому списку, имя не теряется', async () => {
    const id = uniqueUserId()
    await cacheUsers([{ id, name: 'Маша', sort_order: 2 }])
    await setCachedSex(id, 'f')
    expect(await getCachedUser(id)).toMatchObject({ id, name: 'Маша', sex: 'f' })
    await setCachedSex(id, undefined)
    expect((await loginDb.users.get(id)).sex).toBeNull()
  })
})

describe('недавние сессии для автопрогрессии', () => {
  it('свежие сверху, только это упражнение, с оценкой «как пошло», не больше n', async () => {
    const mk = (day, w) => saveWorkout({ user_id: userId, performed_at: `2026-01-0${day}T10:00:00Z`,
      entries: [{ exercise: bench, sets: [{ weight: w, reps: 5 }] }, { exercise: plank, sets: [{ weight: 0, reps: 60 }] }] })
    await mk(1, 80)
    const w2 = await mk(2, 82.5)
    await mk(3, 85)
    await setWorkoutFeels(userId, w2, '2026-01-02T10:00:00Z', { ex_bench: 'easy' })
    const s = await getRecentSessionsForExercise(userId, 'ex_bench', 2)
    expect(s.map((x) => x.sets[0].weight)).toEqual([85, 82.5])
    expect(s[1].feel).toBe('easy')
    expect(s[0].metric).toBe('weight')
    expect(await getRecentSessionsForExercise(userId, null)).toEqual([])
  })
})
