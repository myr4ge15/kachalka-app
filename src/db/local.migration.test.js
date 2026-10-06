// db/local.js — переходные ветки (v6.14.2, замер покрытия 06.10: ветки 24%).
// Перенос несинхронизированных правок со старой ОБЩЕЙ базы `gym_app` в персональную
// `gym_app_<id>` при первом открытии, перенос «загрузочной зоны» (ростер + офлайн-кэш
// PIN) в `gym_app_login`, сериализация open/close. По AGENTS.md здесь уже терялись
// данные: старую базу НЕ удаляем, чистое не тащим, свежее не затираем, повтор — no-op.
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as local from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'

const { openUserDb, closeUserDb, loginDb, getMeta, setMeta, migrateLoginZone, getLoginMeta } = local

// Та же схема v7, что в local.js (defineSchema не экспортируется — старая база сеется руками).
const V7 = {
  exercises: 'id, muscle_group, name, _dirty',
  users: 'id, name',
  workouts: 'id, user_id, performed_at, _dirty, _deleted',
  outbox: '++seq, workoutId, type, createdAt',
  meta: 'key',
  feed: 'id, performed_at',
  ex_outbox: '++seq, exerciseId, createdAt',
  leaderboard: 'user_id, orm',
  templates: 'id, user_id, is_public, _dirty, _deleted',
  tpl_outbox: '++seq, templateId, createdAt',
  reaction_outbox: '++seq, workoutId, createdAt',
}
async function seedOld(fn) {
  const old = new Dexie('gym_app')
  old.version(7).stores(V7)
  await old.open()
  await fn(old)
  old.close()
}
const w = (id, user_id, extra = {}) => ({
  id, user_id, performed_at: '2026-01-01T10:00:00Z', _dirty: 0, _deleted: 0,
  entries: [{ exercise_id: 'ex_custom', sets: [{ weight: 50, reps: 5 }] }], ...extra,
})

beforeEach(async () => {
  await closeUserDb()
  await Dexie.delete('gym_app')
  await loginDb.meta.clear()
  await loginDb.users.clear()
})
afterEach(async () => { await closeUserDb() })

describe('перенос со старой общей базы при первом открытии', () => {
  it('старой базы нет — флаг ставится, повторно не проверяется', async () => {
    const id = uniqueUserId()
    await openUserDb(id)
    expect(await getLoginMeta('migrated_user_' + id)).toBe(true)
    expect(await local.db.workouts.count()).toBe(0)
  })

  it('переносит ТОЛЬКО свои несинхронизированные правки, их очередь и нужные кастомные упражнения', async () => {
    const id = uniqueUserId()
    await seedOld(async (old) => {
      await old.workouts.bulkPut([
        w('dirty', id, { _dirty: 1 }),
        w('deleted', id, { _deleted: 1 }),
        w('clean', id),                          // чистая — доедет pull'ом, не тащим
        w('foreign', 'someone-else', { _dirty: 1 }), // чужая — остается в старой базе
      ])
      await old.outbox.bulkAdd([
        { workoutId: 'dirty', type: 'upsert', createdAt: 't', attempts: 0 },
        { workoutId: 'deleted', type: 'delete', createdAt: 't', attempts: 0 },
        { workoutId: 'foreign', type: 'upsert', createdAt: 't', attempts: 0 },
      ])
      await old.exercises.bulkPut([
        { id: 'ex_custom', name: 'Мое', muscle_group: 'грудь', _dirty: 1 },
        { id: 'ex_other', name: 'Не упомянуто', muscle_group: 'грудь', _dirty: 1 },
      ])
      await old.ex_outbox.bulkAdd([
        { exerciseId: 'ex_custom', createdAt: 't' },
        { exerciseId: 'ex_other', createdAt: 't' },
      ])
      await old.meta.bulkPut([
        { key: 'goal_' + id, value: [{ exerciseId: 'ex_custom', targetWeight: 60, _dirty: 1 }] },
        { key: 'notif_seen_at_' + id, value: '2026-01-02' },
        { key: 'priv_' + id, value: true },
        { key: 'goal_someone-else', value: ['чужое'] },
      ])
    })
    await openUserDb(id)
    const d = local.db
    expect((await d.workouts.toArray()).map((x) => x.id).sort()).toEqual(['deleted', 'dirty'])
    expect((await d.outbox.toArray()).map((o) => `${o.workoutId}:${o.type}`).sort()).toEqual(['deleted:delete', 'dirty:upsert'])
    expect((await d.exercises.toArray()).map((e) => e.id)).toEqual(['ex_custom'])
    expect((await d.ex_outbox.toArray()).map((o) => o.exerciseId)).toEqual(['ex_custom'])
    expect(await getMeta('goal_' + id)).toEqual([expect.objectContaining({ targetWeight: 60 })])
    expect(await getMeta('notif_seen_at_' + id)).toBe('2026-01-02')
    expect(await getMeta('priv_' + id)).toBe(true)
    expect(await getMeta('goal_someone-else')).toBeUndefined()
    // старую базу не удаляем: там правки других учеток устройства
    expect(await Dexie.exists('gym_app')).toBe(true)
    expect(await getLoginMeta('migrated_user_' + id)).toBe(true)
  })

  it('свежее в персональной базе не затирается; повторный прогон ничего не дублирует', async () => {
    const id = uniqueUserId()
    await seedOld(async (old) => {
      await old.workouts.put(w('dirty', id, { _dirty: 1, entries: [] }))
      await old.outbox.add({ workoutId: 'dirty', type: 'upsert', createdAt: 't', attempts: 0 })
      await old.meta.put({ key: 'goal_' + id, value: ['старое'] })
    })
    // Персональная база уже есть и в ней свежая версия той же тренировки и своя цель.
    const pre = new Dexie('gym_app_' + id)
    pre.version(7).stores(V7)
    await pre.open()
    await pre.workouts.put(w('dirty', id, { _dirty: 1, entries: [], note: 'свежее' }))
    await pre.outbox.add({ workoutId: 'dirty', type: 'upsert', createdAt: 'new', attempts: 0 })
    await pre.meta.put({ key: 'goal_' + id, value: ['новое'] })
    pre.close()

    await openUserDb(id)
    expect((await local.db.workouts.get('dirty')).note).toBe('свежее')
    expect(await local.db.outbox.count()).toBe(1)
    expect(await getMeta('goal_' + id)).toEqual(['новое'])

    // Флаг сбросили (как будто прошлый раз упал) — повтор все равно без дублей.
    await loginDb.meta.delete('migrated_user_' + id)
    await closeUserDb()
    await openUserDb(id)
    expect(await local.db.outbox.count()).toBe(1)
    expect(await local.db.workouts.count()).toBe(1)
  })
})

describe('открытие/закрытие персональной базы', () => {
  it('та же учетка — тот же экземпляр; другая — переключение; закрытие — db = null', async () => {
    const a = uniqueUserId(); const b = uniqueUserId()
    const d1 = await openUserDb(a)
    expect(await openUserDb(a)).toBe(d1)
    const d2 = await openUserDb(b)
    expect(d2).not.toBe(d1)
    expect(local.db.name).toBe('gym_app_' + b)
    await closeUserDb()
    expect(local.db).toBeNull()
  })

  it('пустой id — ничего не открывает', async () => {
    expect(await openUserDb(null)).toBeNull()
  })

  it('быстрые open A → open B → close идут строго по очереди', async () => {
    const a = uniqueUserId(); const b = uniqueUserId()
    const p = [openUserDb(a), openUserDb(b), closeUserDb()]
    await Promise.all(p)
    expect(local.db).toBeNull()
    await openUserDb(b)
    expect(local.db.name).toBe('gym_app_' + b)
  })

  it('meta без открытой базы — тихо: чтение undefined, запись no-op', async () => {
    expect(await getMeta('x')).toBeUndefined()
    await expect(setMeta('x', 1)).resolves.toBeUndefined()
  })
})

describe('перенос «загрузочной зоны» (ростер + офлайн-PIN)', () => {
  it('старой базы нет — только флаг', async () => {
    await migrateLoginZone()
    expect(await getLoginMeta('login_zone_migrated')).toBe(true)
    expect(await loginDb.users.count()).toBe(0)
  })

  it('ростер — только в пустой loginDb; pin_* — без затирания; прочая meta — нет', async () => {
    await seedOld(async (old) => {
      await old.users.bulkPut([{ id: 'u1', name: 'Дима' }, { id: 'u2', name: 'Маша' }])
      await old.meta.bulkPut([
        { key: 'pin_u1', value: { pin_hash: 'old1' } },
        { key: 'pin_u2', value: { pin_hash: 'old2' } },
        { key: 'goal_u1', value: ['не туда'] },
      ])
    })
    await loginDb.meta.put({ key: 'pin_u2', value: { pin_hash: 'fresh2' } })
    await migrateLoginZone()
    expect((await loginDb.users.toArray()).map((u) => u.id).sort()).toEqual(['u1', 'u2'])
    expect((await getLoginMeta('pin_u1')).pin_hash).toBe('old1')
    expect((await getLoginMeta('pin_u2')).pin_hash).toBe('fresh2')
    expect(await getLoginMeta('goal_u1')).toBeUndefined()

    // Повтор — no-op (флаг), даже если в старой базе появилось новое.
    await seedOld((old) => old.meta.put({ key: 'pin_u3', value: { pin_hash: 'x' } }))
    await migrateLoginZone()
    expect(await getLoginMeta('pin_u3')).toBeUndefined()
  })

  it('непустой ростер в loginDb не перезаписывается', async () => {
    await seedOld((old) => old.users.put({ id: 'u1', name: 'Старое имя' }))
    await loginDb.users.put({ id: 'u1', name: 'Свежее имя' })
    await migrateLoginZone()
    expect((await loginDb.users.get('u1')).name).toBe('Свежее имя')
  })
})
