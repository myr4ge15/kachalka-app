// Интеграционные тесты DB-обвязки бэкапа (db/backup.js) на реальном Dexie
// (fake-indexeddb). Фокус — новые роды fav/accent (РЕВЬЮ-КОДА-2026-10-02, мелочи):
// попадают в выгрузку, восстанавливаются синкаемой записью (dirty) и сливаются со
// свежим значением, а не со снимком до импорта.
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const dl = vi.hoisted(() => ({ last: null }))
vi.mock('../lib/exportWorkout.js', async (orig) => ({
  ...(await orig()),
  downloadJson: (obj) => { dl.last = obj },
}))

import { openUserDb, closeUserDb } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { toggleFavorite, setAccentPref, getFavorites, getAccentPref } from './repo.js'
import { getUserMetaState } from './userMeta.js'
import { exportAllMyData, importAllMyData } from './backup.js'
import { BACKUP_SCHEMA } from '../lib/backup.js'

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  dl.last = null
})
afterEach(async () => {
  await closeUserDb()
})

const file = (settings) => JSON.stringify({ schema: BACKUP_SCHEMA, user: { id: userId }, settings })

describe('бэкап: избранное и акцент', () => {
  it('выгрузка содержит избранное и свой акцент', async () => {
    await toggleFavorite(userId, 'ex_a')
    await setAccentPref(userId, { id: 'custom', hue: 90 })
    await exportAllMyData(userId)
    expect(dl.last.settings.favorites).toEqual(['ex_a'])
    expect(dl.last.settings.accent).toEqual({ id: 'custom', hue: 90, by: String(userId) })
  })

  it('импорт дописывает недостающее избранное и ставит акцент — синкаемо (dirty)', async () => {
    await toggleFavorite(userId, 'ex_a')
    const counts = await importAllMyData(userId, file({ favorites: ['ex_b', 'ex_a'], accent: { id: 'custom', hue: 30 } }))
    expect(counts).toMatchObject({ fav: 1, accent: 1 })
    expect(await getFavorites(userId)).toEqual(['ex_a', 'ex_b'])
    expect(await getAccentPref(userId)).toEqual({ id: 'custom', hue: 30, by: String(userId) })
    const st = await getUserMetaState()
    expect(st.fav.dirty).toBe(1)
    expect(st.accent.dirty).toBe(1)
  })

  it('свой акцент импорт не перетирает; старый файл без полей ничего не меняет', async () => {
    await setAccentPref(userId, { id: 'ice', hue: 200 })
    await importAllMyData(userId, file({ accent: { id: 'custom', hue: 30, by: userId } }))
    expect((await getAccentPref(userId)).id).toBe('ice')
    const counts = await importAllMyData(userId, file({ progression: null }))
    expect(counts).toMatchObject({ fav: 0, accent: 0 })
  })
})
