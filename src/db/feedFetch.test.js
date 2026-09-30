// fetchFeed на реальном Dexie (fake-indexeddb) и замоканном Supabase: при
// неизменном окне ленты и тех же реакциях кэш не перезаписывается (иначе каждый
// поллинг будил все useLiveQuery по ленте), а новая реакция — записывается.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const server = vi.hoisted(() => ({ workouts: [], reactions: [], session: 'u' }))

vi.mock('./supabase.js', () => {
  function from(table) {
    const b = {
      table,
      selection: '',
      select(s) { b.selection = s; return b },
      order() { return b },
      limit() { return b },
      in() { return b },
      then(ok, fail) {
        let res
        if (table === 'reactions') res = { data: server.reactions, error: null }
        else if (b.selection === 'id, updated_at') res = { data: server.workouts.map(({ id, updated_at }) => ({ id, updated_at })), error: null }
        else res = { data: server.workouts, error: null }
        return Promise.resolve(res).then(ok, fail)
      },
    }
    return b
  }
  return {
    supabase: { from },
    isConfigured: true,
    hasSession: async (userId) => !userId || userId === server.session,
  }
})

import { openUserDb, closeUserDb, db } from './local.js'
import { fetchFeed } from './feed.js'
import { uniqueUserId } from '../test/idbHarness.js'

let userId

beforeEach(async () => {
  // fetchFeed тихо выходит офлайн; у Node свой navigator без onLine.
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
  userId = uniqueUserId()
  server.session = userId
  server.workouts = [{
    id: 'w1', user_id: 'friend', performed_at: '2026-07-28', updated_at: '2026-07-28T10:00:00.000Z',
    user: { id: 'friend', name: 'Дима' }, workout_exercises: [],
  }]
  server.reactions = [{ workout_id: 'w1', user_id: 'x', kind: 'fire', created_at: '2026-07-28T11:00:00.000Z', user: { name: 'Икс' } }]
  await openUserDb(userId)
})

afterEach(async () => {
  await closeUserDb()
})

describe('fetchFeed — запись кэша только при изменениях', () => {
  it('тот же снимок второй раз не пишет в db.feed', async () => {
    await fetchFeed(userId, db)
    const writes = vi.fn()
    db.feed.hook('creating', writes)
    db.feed.hook('deleting', writes)

    await fetchFeed(userId, db)

    expect(writes).not.toHaveBeenCalled()
    expect((await db.feed.get('w1')).reactions).toHaveLength(1)
  })

  it('новая реакция при том же окне — записывается', async () => {
    await fetchFeed(userId, db)
    server.reactions = [...server.reactions, { workout_id: 'w1', user_id: 'y', kind: 'strong', created_at: '2026-07-28T12:00:00.000Z', user: { name: 'Игрек' } }]

    await fetchFeed(userId, db)

    expect((await db.feed.get('w1')).reactions).toHaveLength(2)
  })

  it('под сессией другой учетки ленту не трогает', async () => {
    server.session = 'someone-else'

    await fetchFeed(userId, db)

    expect(await db.feed.count()).toBe(0)
  })
})
