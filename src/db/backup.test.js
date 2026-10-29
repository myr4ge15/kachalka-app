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
import { toggleFavorite, setAccentPref, getFavorites, getAccentPref, getBadges, getRpe, progKey } from './repo.js'
import { getMeta } from './local.js'
import { getUserMetaState } from './userMeta.js'
import { exportAllMyData, importAllMyData } from './backup.js'
import { BACKUP_SCHEMA } from '../lib/backup.js'
import { getBody, saveBodyEntry, setBodyPrefs } from './body.js'
import { localYmd } from '../lib/calendar.js'

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  dl.last = null
})
afterEach(async () => {
  await closeUserDb()
})

const file = (settings, extra = {}) => JSON.stringify({ schema: BACKUP_SCHEMA, user: { id: userId }, settings, ...extra })

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

  it('«Вес и замеры» из файла: недостающие записи дописываются синкаемо, своя запись и цель не перетираются', async () => {
    const day = (n) => localYmd(new Date(Date.now() - n * 86400000))
    const rec = (id, n, weight) => ({ id, date: day(n), weight, at: `${day(n)}T07:00:00.000Z` })
    await saveBodyEntry(userId, rec('a', 1, 82))
    await setBodyPrefs(userId, { goal: { kind: 'keep', target: 82 } })

    const counts = await importAllMyData(userId, file({ body: { entries: [rec('a', 1, 90), rec('b', 3, 82.5)], goal: { kind: 'down', target: 78 } } }))

    expect(counts).toMatchObject({ body: 1 })
    const body = await getBody(userId)
    expect(body.entries.map((e) => [e.id, e.weight])).toEqual([['a', 82], ['b', 82.5]])
    expect(body.goal).toMatchObject({ kind: 'keep', target: 82 })
    expect((await getUserMetaState()).body.dirty).toBe(1)
  })

  it('свой акцент импорт не перетирает; старый файл без полей ничего не меняет', async () => {
    await setAccentPref(userId, { id: 'ice', hue: 200 })
    await importAllMyData(userId, file({ accent: { id: 'custom', hue: 30, by: userId } }))
    expect((await getAccentPref(userId)).id).toBe('ice')
    const counts = await importAllMyData(userId, file({ progression: null }))
    expect(counts).toMatchObject({ fav: 0, accent: 0 })
  })

  it('бейджи, автопрогрессия и оценки «как пошло» — дописываются синкаемо; повтор ничего не добавляет', async () => {
    const extra = {
      badges: { first_workout: { at: '2026-10-01T10:00:00.000Z' }, bad: null },
      rpe: { w1: { at: '2026-10-01T10:00:00.000Z', ex: { ex_a: 'hard' } } },
    }
    const settings = { progression: { enabled: true, byExercise: { ex_a: { step: 2.5 } } } }
    const counts = await importAllMyData(userId, file(settings, extra))
    expect(counts).toMatchObject({ badges: 1, prog: 1, rpe: 1 })
    expect((await getBadges(userId)).first_workout).toMatchObject({ at: '2026-10-01T10:00:00.000Z', backfilled: true })
    expect((await getMeta(progKey(userId))).byExercise.ex_a).toEqual({ step: 2.5 })
    expect((await getRpe(userId)).w1.ex).toEqual({ ex_a: 'hard' })
    const st = await getUserMetaState()
    expect([st.badges.dirty, st.prog.dirty, st.rpe.dirty]).toEqual([1, 1, 1])
    expect(await importAllMyData(userId, file(settings, extra))).toMatchObject({ badges: 0, prog: 0, rpe: 0 })
  })
})
