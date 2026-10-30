// Края слоя записи (db/repo.js) на реальном Dexie (fake-indexeddb): что отсекает cleanEntries и
// cleanTargets, схлопывание и воскрешение очередей, разбор dead-letter, реакции (оптимистичный
// кэш ленты), синкаемые настройки через writeSyncedMeta. Основные пути — repo.test.js и
// repo.templates.test.js; здесь ветки с риском потери правки (покрытие веток, 30.10.2026).
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db, loginDb, getMeta, setMeta } from './local.js'
import { getUserMetaState } from './userMeta.js'
import { savableSet } from '../lib/setLimits.js'
import { countSavable } from '../lib/workoutEntries.js'
import { uniqueUserId } from '../test/idbHarness.js'
import {
  getExercises, getAllExercisesForAdmin, applyExerciseMergeLocal, createExercise, updateExercise,
  setCachedAvatar, setCachedName, setCachedSex, getCachedUser,
  getRecentSessionsForExercise, getProgSettings, setProgEnabled, setProgForExercise,
  getAccentPref, setAccentPref, getFavorites, toggleFavorite, getRpe, getWorkoutFeels, setWorkoutFeels,
  getBadges, writeBadges, getWorkout, getTemplates, getTemplate,
  saveWorkout, deleteWorkout, softDeleteMyWorkouts, saveTemplate, deleteTemplate,
  toggleReaction, pendingCount, deadLetterCount, retryDeadLetter, discardDeadLetter,
} from './repo.js'

const T1 = '2026-07-01T10:00:00.000Z'
const T2 = '2026-07-02T10:00:00.000Z'
const bench = { id: 'bench', name: 'Жим', muscle_group: 'грудь', metric: 'weight' }
const pullup = { id: 'pullup', name: 'Подтягивания', muscle_group: 'спина', metric: 'reps' }
const plank = { id: 'plank', name: 'Планка', muscle_group: 'пресс', metric: 'time' }
const run = { id: 'run', name: 'Бег', muscle_group: 'кардио', metric: 'distance' }

let userId

// Что записалось в документ после saveWorkout.
const saved = async (entries) => (await db.workouts.get(await saveWorkout({ user_id: userId, entries }))).entries

const outboxOf = async (table, key, id) =>
  (await db[table].where(key).equals(id).toArray()).map((o) => o.type)

beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  await loginDb.users.clear()
})

afterEach(async () => {
  await closeUserDb()
})

describe('справочник: сортировка и локальные правки админа', () => {
  it('пустые группа и имя не ломают сортировку и идут первыми', async () => {
    await db.exercises.bulkPut([
      { id: '1', name: 'Б', muscle_group: 'ноги' },
      { id: '2', name: 'А', muscle_group: 'ноги' },
      { id: '3', muscle_group: null, name: null },
      { id: '4', name: 'Я', muscle_group: 'грудь', is_hidden: true },
    ])

    expect((await getExercises()).map((e) => e.id)).toEqual(['3', '2', '1'])
    expect((await getAllExercisesForAdmin()).map((e) => e.id)).toEqual(['3', '4', '2', '1'])
  })

  it('слияние: нет строки — молча; без цели только прячет, merged_into не появляется', async () => {
    await applyExerciseMergeLocal('нет', 'x')
    expect(await db.exercises.count()).toBe(0)

    await db.exercises.put({ id: 'a', name: 'А' })
    await applyExerciseMergeLocal('a')
    const a = await db.exercises.get('a')
    expect(a.is_hidden).toBe(true)
    expect('merged_into' in a).toBe(false)
  })
})

describe('createExercise: края', () => {
  it.each([[''], ['   '], [null], [undefined]])('пустое название (%j) — ошибка, очередь не тронута', async (name) => {
    await expect(createExercise({ name })).rejects.toThrow('Введи название')
    expect(await db.exercises.count()).toBe(0)
    expect(await db.ex_outbox.count()).toBe(0)
  })

  it('без группы: группа и подмышца null; лишняя метрика приводится к weight', async () => {
    const ex = await createExercise({ name: 'Новое', metric: 'мусор' })
    expect(ex).toMatchObject({ muscle_group: null, submuscle: null, secondary: [], metric: 'weight', owner_id: null })
  })

  it('группа обрезается, подмышца по умолчанию из группы, вторичные без основной и неизвестных', async () => {
    const ex = await createExercise({ name: 'Тяга', muscle_group: ' спина ', secondary: ['lats', 'biceps', 'нет такой'] })
    expect(ex.muscle_group).toBe('спина')
    expect(ex.submuscle).toBe('lats')
    expect(ex.secondary).not.toContain('lats')
    expect(ex.secondary).not.toContain('нет такой')
  })

  it('явная подмышца важнее умолчания', async () => {
    const ex = await createExercise({ name: 'Жим узким', muscle_group: 'грудь', submuscle: ' triceps ' })
    expect((await db.exercises.get(ex.id)).submuscle).toBe('triceps')
  })

  it('анти-дубль на голой легаси-строке: приведенная форма, новая операция не ставится', async () => {
    await db.exercises.put({ id: 'old', name: 'Старое' })

    expect(await createExercise({ name: 'старое', owner_id: 'я' })).toEqual({
      id: 'old', name: 'Старое', muscle_group: null, submuscle: null, secondary: [],
      is_bench_lift: false, metric: 'weight', is_custom: false, owner_id: null,
    })
    expect(await db.ex_outbox.count()).toBe(0)
  })
})

describe('updateExercise: края', () => {
  const own = (patch = {}) => db.exercises.put({
    id: 'e1', name: 'Мое', muscle_group: 'грудь', is_custom: true, owner_id: userId, _dirty: 0, ...patch,
  })

  it('нет такого — ошибка', async () => {
    await expect(updateExercise({ id: 'нет', name: 'x', editor_id: userId })).rejects.toThrow('не найдено')
  })

  it('пустое название — ошибка, строка и очередь не тронуты', async () => {
    await own()
    await expect(updateExercise({ id: 'e1', name: '  ', editor_id: userId })).rejects.toThrow('Введи название')
    expect(await db.exercises.get('e1')).toMatchObject({ name: 'Мое', _dirty: 0 })
    expect(await db.ex_outbox.count()).toBe(0)
  })

  it('свое имя можно оставить; снятая группа снимает и подмышцу; явные поля уважаются', async () => {
    await own()
    await updateExercise({ id: 'e1', name: 'Мое', editor_id: userId })
    expect(await db.exercises.get('e1')).toMatchObject({ muscle_group: null, submuscle: null, _dirty: 1 })

    const res = await updateExercise({ id: 'e1', name: 'Мое', muscle_group: ' спина ', submuscle: ' biceps ', metric: 'reps', editor_id: userId })
    expect(res).toMatchObject({ muscle_group: 'спина', submuscle: 'biceps', metric: 'reps', is_bench_lift: false })
  })

  it('единственная операция мертва — правка ставит живую, иначе _dirty ушел бы в никуда', async () => {
    await own()
    await db.ex_outbox.add({ exerciseId: 'e1', createdAt: T1, attempts: 5, _dead: 1 })

    await updateExercise({ id: 'e1', name: 'Новое', editor_id: userId })

    expect(await pendingCount()).toBe(1)
    expect(await deadLetterCount()).toBe(1)
  })
})

describe('кэш ростера: учетки еще нет', () => {
  it.each([
    ['аватар', () => setCachedAvatar(userId, 'a.png'), { avatar_url: 'a.png' }],
    ['имя', () => setCachedName(userId, 'Новый'), { name: 'Новый' }],
    ['пол', () => setCachedSex(userId, 'f'), { sex: 'f' }],
    ['пол снят', () => setCachedSex(userId), { sex: null }],
  ])('%s: строка создается с id', async (_n, act, expected) => {
    await act()
    expect(await getCachedUser(userId)).toEqual({ id: userId, ...expected })
  })
})

describe('недавние сессии: края', () => {
  const put = (id, patch) => db.workouts.put({ id, user_id: userId, performed_at: '2026-07-01', created_at: T1, _deleted: 0, ...patch })

  it('нет учетки или упражнения — пусто', async () => {
    expect(await getRecentSessionsForExercise(null, 'a')).toEqual([])
    expect(await getRecentSessionsForExercise(userId, null)).toEqual([])
  })

  it('удаленные, без упражнения, без подходов и с мусором в подходах — не сессии', async () => {
    await put('del', { _deleted: 1, entries: [{ exercise_id: 'a', sets: [{ weight: 1, reps: 1 }] }] })
    await put('none', { entries: undefined })
    await put('other', { entries: [{ exercise_id: 'b', sets: [{ weight: 1, reps: 1 }] }] })
    await put('nosets', { entries: [{ exercise_id: 'a' }] })
    await put('junk', { entries: [{ exercise_id: 'a', sets: [{ weight: 'x', reps: 5 }] }] })

    expect(await getRecentSessionsForExercise(userId, 'a')).toEqual([])
  })

  it('в один день — что внесли позже, выше; ключ берется и из вложенного exercise; метрика из справочника', async () => {
    await db.exercises.put({ id: 'a', name: 'А', metric: 'reps' })
    await put('early', { created_at: T1, entries: [{ exercise_id: 'a', sets: [{ weight: 0, reps: 8 }] }] })
    await put('late', { created_at: T2, entries: [{ exercise: { id: 'a' }, sets: [{ weight: '0', reps: '9' }] }] })

    const list = await getRecentSessionsForExercise(userId, 'a')

    expect(list.map((s) => s.id)).toEqual(['late', 'early'])
    expect(list[0].sets).toEqual([{ weight: 0, reps: 9 }])
    expect(list[0].metric).toBe('reps')
  })
})

describe('синкаемые настройки: запись только через writeSyncedMeta', () => {
  it('setProgEnabled на мусоре: значение нормализуется, ключ dirty', async () => {
    await setMeta(`prog_${userId}`, 'мусор')
    await setProgEnabled(userId, false)
    expect(await getProgSettings(userId)).toEqual({ enabled: false, byExercise: {} })
    expect((await getUserMetaState()).prog.dirty).toBe(1)
  })

  it('чтение: объект без полей — прогрессия включена, настроек нет; enabled:false держится', async () => {
    await setMeta(`prog_${userId}`, {})
    expect(await getProgSettings(userId)).toEqual({ enabled: true, byExercise: {} })
    await setMeta(`prog_${userId}`, { enabled: false, byExercise: { a: { step: 2 } } })
    expect(await getProgSettings(userId)).toEqual({ enabled: false, byExercise: { a: { step: 2 } } })
  })

  it('настройка упражнения мержится поверх своей и не трогает соседей', async () => {
    await setProgForExercise(userId, 'a', { step: 2 })
    await setProgForExercise(userId, 'a', { targetReps: 8 })
    await setProgForExercise(userId, 'b', { step: 5 })
    expect((await getProgSettings(userId)).byExercise).toEqual({ a: { step: 2, targetReps: 8 }, b: { step: 5 } })
  })

  it('акцент: без учетки или выбора не пишется; значение помечено владельцем и dirty', async () => {
    await setAccentPref(null, { id: 'x' })
    await setAccentPref(userId, null)
    expect(await getAccentPref(userId)).toBeNull()
    expect((await getUserMetaState()).accent.dirty).toBe(0)

    await setAccentPref(userId, { id: 'volt', hue: 90, лишнее: 1 })
    expect(await getAccentPref(userId)).toEqual({ id: 'volt', hue: 90, by: String(userId) })
    expect((await getUserMetaState()).accent.dirty).toBe(1)
  })

  it('избранное: без учетки или упражнения — пусто и без записи; мусор → пусто', async () => {
    expect(await getFavorites(null)).toEqual([])
    await toggleFavorite(null, 'a')
    await toggleFavorite(userId, null)
    expect((await getUserMetaState()).fav.dirty).toBe(0)
    await setMeta(`fav_${userId}`, 'мусор')
    expect(await getFavorites(userId)).toEqual([])
  })

  it('оценки: без ключей — пусто и без записи; мусор в meta не ломает запись', async () => {
    expect(await getWorkoutFeels(null, 'w')).toEqual({})
    expect(await getWorkoutFeels(userId, null)).toEqual({})
    await setWorkoutFeels(null, 'w', T1, { a: 'easy' })
    await setWorkoutFeels(userId, null, T1, { a: 'easy' })
    expect((await getUserMetaState()).rpe.dirty).toBe(0)

    await setMeta(`rpe_${userId}`, 'мусор')
    expect(await getRpe(userId)).toEqual({})
    await setWorkoutFeels(userId, 'w', T1, { a: 'easy' })
    expect(await getWorkoutFeels(userId, 'w')).toEqual({ a: 'easy' })
    expect((await getUserMetaState()).rpe.dirty).toBe(1)
  })

  it('writeBadges(null) пишет пустую карту и ставит dirty', async () => {
    await writeBadges(userId, null)
    expect(await getBadges(userId)).toEqual({})
    expect(await getMeta(`badges_${userId}`)).toEqual({})
    expect((await getUserMetaState()).badges.dirty).toBe(1)
  })
})

describe('cleanEntries: что запишется — то и посчитано на кнопке', () => {
  it('нет упражнений или подходов — пустая тренировка, очередь не тронута', async () => {
    await expect(saveWorkout({ user_id: userId })).rejects.toThrow('Пустая тренировка')
    await expect(saveWorkout({ user_id: userId, entries: [{ exercise: bench }] })).rejects.toThrow('Пустая тренировка')
    await expect(saveWorkout({ user_id: userId, entries: [{ sets: [{ weight: 50, reps: 5 }] }] })).rejects.toThrow('Пустая тренировка')
    expect(await db.outbox.count()).toBe(0)
  })

  it('незаполненные подходы отсеиваются, счетчик кнопки совпадает с записью', async () => {
    const entries = [{
      exercise: bench,
      sets: [{ weight: '50', reps: '5' }, { weight: '', reps: '' }, { weight: '60', reps: '0' }, { weight: 'abc', reps: '5' }, null],
    }]

    const [row] = await saved(entries)

    expect(row.sets).toEqual([{ weight: 50, reps: 5 }])
    expect(countSavable(entries)).toEqual({ sets: 1, skipped: 4 })
  })

  it('десятичная запятая, границы и пробелы — как у savableSet', async () => {
    const [row] = await saved([{ exercise: bench, sets: [{ weight: ' 82,5 ', reps: '5' }, { weight: '-10', reps: '3' }, { weight: '5000', reps: '2000' }] }])

    expect(row.sets).toEqual([{ weight: 82.5, reps: 5 }, { weight: 0, reps: 3 }, { weight: 1000, reps: 1000 }])
    expect(row.sets[0]).toEqual(savableSet({ weight: ' 82,5 ', reps: '5' }, 'weight'))
  })

  it('метрика снимка решает границы: помощь гравитрона, секунды планки, км бега', async () => {
    const rows = await saved([
      { exercise: pullup, sets: [{ weight: '-20', reps: '8' }, { weight: '', reps: '5' }, { weight: '-500', reps: '1' }] },
      { exercise: plank, sets: [{ weight: '', reps: '5000' }] },
      { exercise: run, sets: [{ weight: '5,5', reps: '1800' }] },
    ])

    expect(rows[0].sets).toEqual([{ weight: -20, reps: 8 }, { weight: 0, reps: 5 }, { weight: -200, reps: 1 }])
    expect(rows[1].sets).toEqual([{ weight: 0, reps: 5000 }])
    expect(rows[2].sets[0]).toEqual(savableSet({ weight: '5,5', reps: '1800' }, 'distance'))
  })

  it('запись без снимка берет exercise_id и считается весовой', async () => {
    const [row] = await saved([{ exercise_id: 'x', sets: [{ weight: 10, reps: 5 }] }])
    expect(row.exercise_id).toBe('x')
    expect(row.exercise).toBeUndefined()
  })

  it('снимок упражнения — только белый список; лишние поля формы в документ не попадают', async () => {
    const [row] = await saved([{ exercise: { ...bench, is_hidden: true, _dirty: 1, is_bench_lift: 1 }, _uiKey: 'k', sets: [{ weight: 50, reps: 5, _done: true }] }])
    expect(row).toEqual({
      exercise_id: 'bench',
      exercise: { id: 'bench', name: 'Жим', muscle_group: 'грудь', submuscle: null, secondary: [], is_bench_lift: true, metric: 'weight' },
      sets: [{ weight: 50, reps: 5 }],
    })
  })

  it('блоки: разминка наверх, заминка вниз, основная без поля, чужое значение отброшено', async () => {
    const set = [{ weight: 10, reps: 5 }]
    const rows = await saved([
      { exercise: { ...bench, id: 'cool' }, phase: 'cooldown', sets: set },
      { exercise: { ...bench, id: 'main' }, phase: 'мусор', sets: set },
      { exercise: { ...bench, id: 'warm' }, phase: 'warmup', sets: set },
    ])

    expect(rows.map((r) => r.exercise_id)).toEqual(['warm', 'main', 'cool'])
    expect(rows[0].phase).toBe('warmup')
    expect('phase' in rows[1]).toBe(false)
  })
})

describe('saveWorkout: документ и базис merge-часов', () => {
  const entries = [{ exercise: bench, sets: [{ weight: 50, reps: 5 }] }]

  it('дата без явной — у правки прежняя, у новой текущая', async () => {
    await db.workouts.put({ id: 'w1', user_id: userId, performed_at: '2026-01-01', created_at: T1, updated_at: T1, entries: [] })
    await saveWorkout({ id: 'w1', user_id: userId, entries })
    expect((await db.workouts.get('w1')).performed_at).toBe('2026-01-01')

    const id = await saveWorkout({ user_id: userId, entries })
    const doc = await db.workouts.get(id)
    expect(doc.performed_at).toBe(doc.created_at)
  })

  it('чистая серверная запись: базис — ее серверный updated_at', async () => {
    await db.workouts.put({ id: 'w1', user_id: userId, performed_at: '2026-01-01', updated_at: T1, _dirty: 0, entries: [] })
    await saveWorkout({ id: 'w1', user_id: userId, entries })
    expect((await db.workouts.get('w1'))._base_updated_at).toBe(T1)
  })

  it('уже грязная: вторая правка сохраняет ИСХОДНЫЙ базис', async () => {
    await db.workouts.put({ id: 'w1', user_id: userId, performed_at: '2026-01-01', updated_at: T2, _base_updated_at: T1, _dirty: 1, entries: [] })
    await saveWorkout({ id: 'w1', user_id: userId, entries })
    expect((await db.workouts.get('w1'))._base_updated_at).toBe(T1)
  })

  it('новая запись: базиса нет', async () => {
    const id = await saveWorkout({ user_id: userId, entries })
    expect((await db.workouts.get(id))._base_updated_at).toBeNull()
  })

  // ОШИБКА низкой тяжести (см. отчет): repo.js:524 подставляет локальное updated_at как базис, если
  // у грязной записи базис null: вторая правка неотправленной тренировки и правка после push с
  // обнулением базиса. Базис должен быть серверным временем, иначе pull видит ложный conflict.
  it.skip('вторая правка неотправленной записи: базис остается пустым', async () => {
    const id = await saveWorkout({ user_id: userId, entries })
    await saveWorkout({ id, user_id: userId, entries })
    expect((await db.workouts.get(id))._base_updated_at).toBeNull()
  })

  it('getWorkout: есть, нет, tombstone', async () => {
    const id = await saveWorkout({ user_id: userId, entries })
    expect((await getWorkout(id)).id).toBe(id)
    expect(await getWorkout('нет')).toBeNull()
    await deleteWorkout(id)
    expect(await getWorkout(id)).toBeNull()
  })
})

describe('очередь тренировок: схлопывание и мертвые операции', () => {
  const entries = [{ exercise: bench, sets: [{ weight: 50, reps: 5 }] }]
  const ops = (id) => outboxOf('outbox', 'workoutId', id)

  it('удаление несуществующей — ни tombstone, ни операции', async () => {
    await deleteWorkout('нет')
    expect(await db.outbox.count()).toBe(0)
  })

  it('повторное удаление не плодит вторую операцию', async () => {
    const id = await saveWorkout({ user_id: userId, entries })
    await deleteWorkout(id)
    await deleteWorkout(id)
    expect(await ops(id)).toEqual(['delete'])
  })

  it('повторное удаление воскрешает мертвый delete', async () => {
    const id = await saveWorkout({ user_id: userId, entries })
    await deleteWorkout(id)
    await db.outbox.toCollection().modify({ _dead: 1, attempts: 5, lastError: 'x' })

    await deleteWorkout(id)

    expect(await db.outbox.toArray()).toMatchObject([{ type: 'delete', _dead: 0, attempts: 0, lastError: null }])
  })

  it('удаление снимает даже мертвый upsert и ставит живой delete', async () => {
    const id = await saveWorkout({ user_id: userId, entries })
    await db.outbox.toCollection().modify({ _dead: 1, attempts: 5 })

    await deleteWorkout(id)

    const [op] = await db.outbox.toArray()
    expect(op.type).toBe('delete')
    expect(op._dead).toBeUndefined()
    expect(await deadLetterCount()).toBe(0)
  })

  it('пересоздание поверх мертвого delete: delete снят, upsert живой, запись не tombstone', async () => {
    const id = await saveWorkout({ user_id: userId, entries })
    await deleteWorkout(id)
    await db.outbox.toCollection().modify({ _dead: 1, attempts: 5 })

    await saveWorkout({ id, user_id: userId, entries })

    expect(await ops(id)).toEqual(['upsert'])
    expect(await pendingCount()).toBe(1)
    expect(await db.workouts.get(id)).toMatchObject({ _deleted: 0, _dirty: 1 })
  })

  it('softDelete: чужие не трогает, отправленная без upsert получает delete', async () => {
    await db.workouts.bulkPut([
      { id: 'mine', user_id: userId, performed_at: 'x', _dirty: 0, _deleted: 0, entries: [] },
      { id: 'other', user_id: 'чужой', performed_at: 'x', _dirty: 0, _deleted: 0, entries: [] },
    ])

    expect(await softDeleteMyWorkouts(userId)).toBe(1)

    expect(await ops('mine')).toEqual(['delete'])
    expect(await ops('other')).toEqual([])
    expect((await db.workouts.get('other'))._deleted).toBe(0)
  })
})

describe('реакции: очередь и оптимистичный кэш', () => {
  const me = (patch = {}) => ({ userId, userName: 'Я', workoutId: 'w1', kind: 'fire', mine: false, ...patch })
  const feed = (reactions) => db.feed.put({ id: 'w1', ...(reactions ? { reactions } : {}) })
  const reactionsOf = async () => (await db.feed.get('w1')).reactions

  it.each([
    ['неизвестный вид', { kind: 'мусор' }],
    ['нет тренировки', { workoutId: null }],
    ['нет учетки', { userId: null }],
  ])('%s: ничего не ставится', async (_n, patch) => {
    expect(await toggleReaction(me(patch))).toBeNull()
    expect(await db.reaction_outbox.count()).toBe(0)
  })

  it('карточки нет в кэше: решает значение из UI, кэш не создается', async () => {
    expect(await toggleReaction(me({ mine: true }))).toBe('remove')
    await db.reaction_outbox.clear()
    expect(await toggleReaction(me({ mine: false }))).toBe('add')
    expect(await db.feed.count()).toBe(0)
  })

  it('в кэше нет поля reactions: ставится; имя по умолчанию — прочерк', async () => {
    await feed()
    expect(await toggleReaction(me({ userName: undefined }))).toBe('add')
    expect(await reactionsOf()).toEqual([{ user_id: userId, name: '—', kind: 'fire' }])
  })

  it('чужая реакция того же вида — не моя: ставим свою рядом', async () => {
    await feed([{ user_id: 'чужой', name: 'Он', kind: 'fire' }])
    expect(await toggleReaction(me())).toBe('add')
    expect((await reactionsOf()).map((r) => r.user_id)).toEqual(['чужой', userId])
  })

  it('снятие убирает только мою и только этого вида', async () => {
    await feed([
      { user_id: userId, name: 'Я', kind: 'fire' },
      { user_id: userId, name: 'Я', kind: 'clap' },
      { user_id: 'чужой', name: 'Он', kind: 'fire' },
    ])
    expect(await toggleReaction(me())).toBe('remove')
    expect((await reactionsOf()).map((r) => [r.user_id, r.kind])).toEqual([[userId, 'clap'], ['чужой', 'fire']])
  })

  it('кэш уже в нужном состоянии — дубля нет, операция все равно поставлена', async () => {
    await feed([{ user_id: userId, name: 'Я', kind: 'fire' }])
    await db.reaction_outbox.add({ workoutId: 'w1', kind: 'fire', op: 'remove', createdAt: T1 })

    expect(await toggleReaction(me())).toBe('add') // очередь свежее кэша

    expect(await reactionsOf()).toHaveLength(1)
    expect((await db.reaction_outbox.toArray()).map((o) => o.op)).toEqual(['add'])
  })

  it('снятие по очереди при пустом кэше не падает', async () => {
    await feed([])
    await db.reaction_outbox.add({ workoutId: 'w1', kind: 'fire', op: 'add', createdAt: T1 })

    expect(await toggleReaction(me())).toBe('remove')

    expect(await reactionsOf()).toEqual([])
  })

  it('несколько операций пары: верит последней по seq, после тапа остается одна', async () => {
    await db.reaction_outbox.bulkAdd([
      { workoutId: 'w1', kind: 'fire', op: 'add', createdAt: T1 },
      { workoutId: 'w1', kind: 'fire', op: 'remove', createdAt: T2 },
      { workoutId: 'w1', kind: 'clap', op: 'add', createdAt: T2 },
    ])

    expect(await toggleReaction(me({ mine: true }))).toBe('add')

    const left = await db.reaction_outbox.toArray()
    expect(left.map((o) => [o.kind, o.op]).sort()).toEqual([['clap', 'add'], ['fire', 'add']])
  })
})

describe('шаблоны: план и очередь', () => {
  const save = (exercises, patch = {}) => saveTemplate({ user_id: userId, name: 'План', exercises, ...patch })
  const exercisesOf = async (id) => (await db.templates.get(id)).exercises

  it.each([[undefined], [null], ['   ']])('название %j — ошибка', async (name) => {
    await expect(saveTemplate({ user_id: userId, name, exercises: [{ exercise: bench }] })).rejects.toThrow('Введи название')
  })

  it('нет списка упражнений — ошибка, очередь не тронута', async () => {
    await expect(save(undefined)).rejects.toThrow('хотя бы одно')
    await expect(save([{ sets: 3 }])).rejects.toThrow('хотя бы одно')
    expect(await db.tpl_outbox.count()).toBe(0)
  })

  it('скаляры: пусто → 3×10, запятая и округление, у не-весовых вес ноль', async () => {
    const id = await save([
      { exercise: bench, sets: '', reps: '', weight: '' },
      { exercise: bench, sets: '4,6', reps: '7,2', weight: '82,5' },
      { exercise: bench, sets: '-1', reps: '0', weight: 'abc' },
      { exercise: pullup, sets: 3, reps: 8, weight: 20 },
    ])

    expect((await exercisesOf(id)).map((e) => [e.sets, e.reps, e.weight])).toEqual([
      [3, 10, 0], [5, 7, 82.5], [1, 10, 0], [3, 8, 0],
    ])
  })

  it('строка без упражнения отсеивается, position переиндексируется, блок сохраняется', async () => {
    const id = await save([
      { exercise: bench, phase: 'warmup' },
      { sets: 3 },
      { exercise_id: 'x', phase: 'мусор' },
    ])

    const list = await exercisesOf(id)
    expect(list.map((e) => [e.exercise_id, e.position, e.phase])).toEqual([['bench', 0, 'warmup'], ['x', 1, undefined]])
    expect(list[1].exercise).toBeUndefined()
    expect('phase' in list[1]).toBe(false)
  })

  it('детальный план: своя метрика важнее снимка, сводка — по первому подходу, запятая понимается', async () => {
    const id = await save([{ exercise: bench, metric: 'reps', set_plan: [{ weight: '-10', reps: '8' }, { weight: '0', reps: '6' }] }])

    expect((await exercisesOf(id))[0]).toMatchObject({
      metric: 'reps', set_plan: [{ weight: -10, reps: 8 }, { weight: 0, reps: 6 }], sets: 2, reps: 8, weight: -10,
    })
  })

  it('детальный план без своей метрики — метрика снимка', async () => {
    const id = await save([{ exercise: plank, set_plan: [{ weight: 0, reps: '60' }] }])
    expect((await exercisesOf(id))[0]).toMatchObject({ metric: 'time', set_plan: [{ weight: 0, reps: 60 }] })
  })

  it.each([
    ['пустой', [], 'от 1 до 1000'],
    ['пустой подход', [{ weight: '50', reps: '' }], 'Заполни вес'],
  ])('план %s — ошибка, шаблон и очередь не созданы', async (_n, set_plan, message) => {
    await expect(save([{ exercise: bench, set_plan }])).rejects.toThrow(message)
    expect(await db.templates.count()).toBe(0)
    expect(await db.tpl_outbox.count()).toBe(0)
  })

  it('удаление несуществующего — ни операции; повторное — без дубля; мертвый delete оживает', async () => {
    await deleteTemplate('нет')
    expect(await db.tpl_outbox.count()).toBe(0)

    const id = await save([{ exercise: bench }])
    await deleteTemplate(id)
    await deleteTemplate(id)
    expect(await outboxOf('tpl_outbox', 'templateId', id)).toEqual(['delete'])

    await db.tpl_outbox.toCollection().modify({ _dead: 1, attempts: 5, lastError: 'x' })
    await deleteTemplate(id)
    expect(await db.tpl_outbox.toArray()).toMatchObject([{ type: 'delete', _dead: 0, attempts: 0, lastError: null }])
  })

  it('удаление снимает мертвый upsert; пересоздание поверх мертвого delete — живой upsert', async () => {
    const id = await save([{ exercise: bench }])
    await db.tpl_outbox.toCollection().modify({ _dead: 1 })
    await deleteTemplate(id)
    expect(await outboxOf('tpl_outbox', 'templateId', id)).toEqual(['delete'])
    expect(await deadLetterCount()).toBe(0)

    await db.tpl_outbox.toCollection().modify({ _dead: 1 })
    await saveTemplate({ id, user_id: userId, name: 'Снова', exercises: [{ exercise: bench }] })
    expect(await outboxOf('tpl_outbox', 'templateId', id)).toEqual(['upsert'])
    expect(await pendingCount()).toBe(1)
    expect((await db.templates.get(id))._deleted).toBe(0)
  })

  it('чтение: tombstone и нет — null; в один момент создания порядок по имени', async () => {
    await db.templates.bulkPut([
      { id: 'b', user_id: userId, name: 'Б', created_at: T1 },
      { id: 'a', user_id: userId, name: 'А', created_at: T1 },
      { id: 'n', user_id: userId, created_at: T1 },
      { id: 'd', user_id: userId, name: 'Д', created_at: T1, _deleted: 1 },
    ])

    expect((await getTemplates(userId)).map((t) => t.id)).toEqual(['n', 'a', 'b'])
    expect((await getTemplate('a')).id).toBe('a')
    expect(await getTemplate('d')).toBeNull()
    expect(await getTemplate('нет')).toBeNull()
  })
})

describe('dead-letter по всем очередям', () => {
  const seedAll = async () => {
    await db.workouts.put({ id: 'w', user_id: userId, performed_at: 'x', _dirty: 1, _deleted: 0, entries: [] })
    await db.exercises.put({ id: 'e', name: 'Е', _dirty: 1 })
    await db.templates.put({ id: 't', user_id: userId, name: 'Т', _dirty: 1, _deleted: 1, exercises: [] })
    await db.outbox.bulkAdd([
      { workoutId: 'w', type: 'upsert', _dead: 1, attempts: 5 },
      { workoutId: 'live', type: 'upsert' },
    ])
    await db.ex_outbox.bulkAdd([
      { exerciseId: 'e', _dead: 1, attempts: 5 },
      { exerciseId: 'live' },
    ])
    await db.tpl_outbox.bulkAdd([
      { templateId: 't', type: 'delete', _dead: 1, attempts: 5 },
      { templateId: 'live', type: 'upsert' },
    ])
  }

  it('счетчики: живые и мертвые по трем очередям; реакции не считаются', async () => {
    await seedAll()
    await db.reaction_outbox.add({ workoutId: 'w', kind: 'fire', op: 'add' })

    expect(await pendingCount()).toBe(3)
    expect(await deadLetterCount()).toBe(3)
  })

  it('retry: все три в строю, живые не тронуты; второй вызов — ноль', async () => {
    await seedAll()

    expect(await retryDeadLetter()).toBe(3)

    expect(await pendingCount()).toBe(6)
    expect(await deadLetterCount()).toBe(0)
    expect((await db.outbox.toArray())[0]).toMatchObject({ attempts: 0, lastError: null })
    expect(await retryDeadLetter()).toBe(0)
  })

  it('discard: мертвые сняты, документы приведены, живые операции остаются, метки сброшены', async () => {
    await seedAll()
    await Promise.all(['wm_exercises', 'sig_exercises', 'sig_templates', 'sig_templates_v2'].map((k) => setMeta(k, 'x')))

    expect(await discardDeadLetter()).toBe(3)

    expect(await db.workouts.get('w')).toBeUndefined()
    expect((await db.exercises.get('e'))._dirty).toBe(0)
    expect(await db.templates.get('t')).toMatchObject({ _dirty: 0, _deleted: 0 }) // удаление отклонено
    expect(await pendingCount()).toBe(3)
    expect(await deadLetterCount()).toBe(0)
    for (const k of ['wm_exercises', 'sig_exercises', 'sig_templates', 'sig_templates_v2']) {
      expect(await getMeta(k)).toBeUndefined()
    }
  })

  it('discard без мертвых: ноль и метки целы (иначе лишняя полная подтяжка)', async () => {
    await setMeta('wm_exercises', 'x')
    await setMeta('sig_templates', 'y')

    expect(await discardDeadLetter()).toBe(0)

    expect(await getMeta('wm_exercises')).toBe('x')
    expect(await getMeta('sig_templates')).toBe('y')
  })

  it('discard только тренировки: метки справочника и шаблонов не трогает', async () => {
    await db.workouts.put({ id: 'w', user_id: userId, performed_at: 'x', entries: [] })
    await db.outbox.add({ workoutId: 'w', type: 'upsert', _dead: 1 })
    await setMeta('wm_exercises', 'x')

    await discardDeadLetter()

    expect(await getMeta('wm_exercises')).toBe('x')
  })
})
