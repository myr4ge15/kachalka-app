// Интеграционные тесты слоя состояния синка личного meta (db/userMeta.js) на
// реальном Dexie (fake-indexeddb). Фокус — updateSyncedMeta: read-modify-write
// синкаемого рода ОДНОЙ транзакцией (РЕВЬЮ-КОДА-2026-10-02, мелочи).
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import {
  updateSyncedMeta, writeSyncedMeta, readSyncedMeta, getUserMetaState, setUserMetaState,
} from './userMeta.js'

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
})
afterEach(async () => {
  await closeUserDb()
})

describe('updateSyncedMeta', () => {
  it('fn получает текущее значение (null, если ключа нет), пишет результат и ставит dirty', async () => {
    const seen = []
    const out = await updateSyncedMeta(userId, 'fav', (cur) => { seen.push(cur); return ['a'] }, db)
    expect(seen).toEqual([null])
    expect(out).toEqual(['a'])
    expect(await readSyncedMeta(userId, 'fav', db)).toEqual(['a'])
    const st = (await getUserMetaState(db)).fav
    expect(st.dirty).toBe(1)
    expect(st.at).toBeTruthy()
  })

  it('base (последняя виденная серверная версия) не трогается — как у writeSyncedMeta', async () => {
    await setUserMetaState('prog', { base: '2026-07-01T00:00:00.000Z' }, db)
    await updateSyncedMeta(userId, 'prog', () => ({ enabled: false, byExercise: {} }), db)
    expect((await getUserMetaState(db)).prog.base).toBe('2026-07-01T00:00:00.000Z')
  })

  it('fn вернула тот же объект — ничего не пишем и dirty не ставим', async () => {
    const out = await updateSyncedMeta(userId, 'badges', (cur) => cur, db)
    expect(out).toBe(null)
    expect((await getUserMetaState(db)).badges.dirty).toBe(0)
  })

  it('параллельные правки не теряют друг друга (чтение внутри транзакции записи)', async () => {
    await writeSyncedMeta(userId, 'fav', [], db)
    await Promise.all(['a', 'b', 'c'].map((id) =>
      updateSyncedMeta(userId, 'fav', (cur) => [...(cur ?? []), id], db)
    ))
    expect((await readSyncedMeta(userId, 'fav', db)).sort()).toEqual(['a', 'b', 'c'])
  })
})
