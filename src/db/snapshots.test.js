// Снимки «Мои круги» (db/circles.js) и «Друзья» (db/friends.js) в персональном meta: витрина
// живет на снимке офлайн, обновление — только онлайн, ошибку не бросает, снимок не портит;
// ответ, пришедший после смены учетки, в чужую базу не пишется (покрытие тестами 20.10.2026).
import '../test/idbHarness.js' // ПЕРВЫМ: fake-indexeddb до Dexie
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeUserDb, openUserDb, getMeta, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'

const circles = vi.hoisted(() => ({ myCircles: null }))
const friends = vi.hoisted(() => ({ list: null }))
vi.mock('../lib/friendCircles.js', () => ({ circleApi: () => ({ myCircles: (...a) => circles.myCircles(...a) }) }))
vi.mock('../lib/friends.js', () => ({ friendsApi: () => ({ list: (...a) => friends.list(...a) }) }))
const { getMyCircles, refreshMyCircles } = await import('./circles.js')
const { getFriends, refreshFriends } = await import('./friends.js')

const CASES = [
  ['Мои круги', getMyCircles, refreshMyCircles, 'fc_circles', (fn) => { circles.myCircles = fn }],
  ['Друзья', getFriends, refreshFriends, 'fr_list', (fn) => { friends.list = fn }],
]

let uid
beforeEach(async () => {
  uid = uniqueUserId()
  await openUserDb(uid)
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(async () => { vi.unstubAllGlobals(); await closeUserDb() })

for (const [title, get, refresh, key, setApi] of CASES) {
  describe(title, () => {
    it('снимка нет — null; после обновления — список и время', async () => {
      expect(await get()).toBeNull()
      setApi(vi.fn(async () => [{ id: 'a' }]))
      expect(await refresh(uid)).toEqual([{ id: 'a' }])
      expect(await get()).toEqual([{ id: 'a' }])
      expect((await getMeta(key, db)).fetchedAt).toMatch(/^\d{4}-/)
    })

    it('офлайн — к серверу не ходим, снимок прежний', async () => {
      const fn = vi.fn(async () => [{ id: 'b' }])
      setApi(fn)
      await refresh(uid)
      vi.stubGlobal('navigator', { onLine: false })
      expect(await refresh(uid)).toBeNull()
      expect(fn).toHaveBeenCalledTimes(1)
      expect(await get()).toEqual([{ id: 'b' }])
    })

    it('ошибка сервера — null без исключения, снимок не тронут', async () => {
      setApi(vi.fn(async () => [{ id: 'c' }]))
      await refresh(uid)
      setApi(vi.fn(async () => { throw new Error('PGRST202') }))
      expect(await refresh(uid)).toBeNull()
      expect(await get()).toEqual([{ id: 'c' }])
    })

    it('ответ пришел после выхода/смены учетки — в новую базу не пишем', async () => {
      let release
      setApi(vi.fn(() => new Promise((r) => { release = r })))
      const pending = refresh(uid)
      await new Promise((r) => setTimeout(r, 0))
      await closeUserDb()
      await openUserDb(uniqueUserId())
      release([{ id: 'чужое' }])
      expect(await pending).toBeNull()
      expect(await get()).toBeNull()
    })

    it('без открытой базы — null, без запроса', async () => {
      await closeUserDb()
      const fn = vi.fn(async () => [])
      setApi(fn)
      expect(await get()).toBeNull()
      expect(await refresh(uid)).toBeNull()
      expect(fn).not.toHaveBeenCalled()
    })
  })
}
