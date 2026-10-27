// «Вес и замеры» — DB-слой на реальном Dexie (fake-indexeddb): правки идут синкаемой
// записью (dirty), невалидное не пишется, «Удалить мои данные» оставляет надгробия.
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { getUserMetaState } from './userMeta.js'
import { getBody, saveBodyEntry, deleteBodyEntry, setBodyPrefs, clearMyBody, bodyKey } from './body.js'

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
})
afterEach(async () => {
  await closeUserDb()
})

describe('db/body', () => {
  it('без записей — пустой документ, ключ body_<id>', async () => {
    expect(await getBody(userId)).toMatchObject({ entries: [], goal: null, hide: false })
    expect(bodyKey('u1')).toBe('body_u1')
    expect(await getBody(null)).toMatchObject({ entries: [] })
  })

  it('запись ставит dirty рода body; правка по id — та же запись', async () => {
    const id = await saveBodyEntry(userId, { date: '2026-10-27', weight: '82,3' })
    expect(id).toBeTruthy()
    expect((await getUserMetaState(db)).body.dirty).toBe(1)
    await saveBodyEntry(userId, { id, date: '2026-10-27', weight: 82.1 })
    const b = await getBody(userId)
    expect(b.entries).toHaveLength(1)
    expect(b.entries[0]).toMatchObject({ id, weight: 82.1 })
  })

  it('пустая запись не пишется', async () => {
    expect(await saveBodyEntry(userId, { date: '2026-10-27', weight: '' })).toBeNull()
    expect((await getUserMetaState(db)).body.dirty).toBe(0)
  })

  it('удаление — надгробие; настройки; «Удалить мои данные»', async () => {
    const a = await saveBodyEntry(userId, { date: '2026-10-26', weight: 82.6 })
    await saveBodyEntry(userId, { date: '2026-10-27', weight: 82.3, waist: 84 })
    await deleteBodyEntry(userId, a)
    let b = await getBody(userId)
    expect(b.entries.find((e) => e.id === a).del).toBe(true)
    await setBodyPrefs(userId, { hide: true, fields: ['waist'], goal: { kind: 'down', target: 78 } })
    b = await getBody(userId)
    expect(b).toMatchObject({ hide: true, fields: ['waist'], goal: { kind: 'down', target: 78 } })
    await clearMyBody(userId)
    b = await getBody(userId)
    expect(b.entries.every((e) => e.del)).toBe(true)
    expect(b.goal).toBeNull()
    expect(b.hide).toBe(true)
  })
})
