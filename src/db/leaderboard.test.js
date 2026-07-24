// Тесты лидерборда (db/leaderboard.js). Чистые функции ранжирования/разбивки
// (cmpBoard/viewerBoard/splitBoards/computeBoardFromFeed) до сих пор были без
// покрытия, хотя это ядро рейтинга; плюс интеграционный getCachedLeaderboard
// (приоритет серверного снимка → фолбэк из кэша ленты) на fake-indexeddb.
import 'fake-indexeddb/auto' // ПЕРВЫМ: local.js создаёт Dexie на импорте
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db, loginDb } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import {
  cmpBoard, viewerBoard, splitBoards, computeBoardFromFeed, getCachedLeaderboard,
} from './leaderboard.js'

describe('cmpBoard (порядок рейтинга)', () => {
  it('тяжелее — выше', () => {
    expect(cmpBoard({ weight: 120, reps: 1 }, { weight: 100, reps: 5 })).toBeLessThan(0)
  })
  it('при равном весе — больше повторов выше', () => {
    expect(cmpBoard({ weight: 100, reps: 8 }, { weight: 100, reps: 5 })).toBeLessThan(0)
  })
  it('при равных весе и повторах — кто раньше достиг', () => {
    const a = { weight: 100, reps: 5, performed_at: '2026-01-01' }
    const b = { weight: 100, reps: 5, performed_at: '2026-03-01' }
    expect(cmpBoard(a, b)).toBeLessThan(0)
  })
})

describe('viewerBoard', () => {
  it("'f' → женский борд", () => expect(viewerBoard('f')).toBe('f'))
  it("'m' → мужской", () => expect(viewerBoard('m')).toBe('m'))
  it('неизвестный пол (NULL) → мужской (обратная совместимость)', () => {
    expect(viewerBoard(null)).toBe('m')
    expect(viewerBoard(undefined)).toBe('m')
  })
})

describe('splitBoards', () => {
  it('делит по полю board и сортирует каждый', () => {
    const rows = [
      { board: 'm', weight: 100, reps: 5 },
      { board: 'f', weight: 60, reps: 5 },
      { board: 'm', weight: 120, reps: 3 },
    ]
    const { male, female } = splitBoards(rows)
    expect(male.map((r) => r.weight)).toEqual([120, 100]) // тяжелее сверху
    expect(female).toHaveLength(1)
  })
  it('строки без board уходят в мужской борд (старый сервер)', () => {
    const { male } = splitBoards([{ weight: 80, reps: 5 }])
    expect(male).toHaveLength(1)
  })
})

describe('computeBoardFromFeed (фолбэк из ленты)', () => {
  const feedItem = (user_id, user_name, exFlags, sets, at = '2026-05-01') => ({
    user_id, user_name, performed_at: at,
    entries: [{ ...exFlags, sets }],
  })

  it('мужской борд по жиму: лучший подход, ранжирование по весу', () => {
    const feed = [
      feedItem('a', 'Аня', { is_bench_lift: true }, [{ weight: 90, reps: 5 }]),
      feedItem('b', 'Боря', { is_bench_lift: true }, [{ weight: 110, reps: 3 }, { weight: 100, reps: 5 }]),
    ]
    const sex = new Map([['a', 'm'], ['b', 'm']])
    const { male } = computeBoardFromFeed(feed, sex)
    expect(male.map((r) => r.user_id)).toEqual(['b', 'a']) // Боря 110 > Аня 90
    expect(male[0].weight).toBe(110)
  })

  it('женский борд — по ягодичному мостику, пол f', () => {
    const feed = [
      feedItem('c', 'Вика', { is_female_lift: true }, [{ weight: 70, reps: 8 }]),
    ]
    const sex = new Map([['c', 'f']])
    const { female, male } = computeBoardFromFeed(feed, sex)
    expect(female.map((r) => r.user_id)).toEqual(['c'])
    expect(male).toHaveLength(0)
  })

  it('подходы без веса/повторов игнорируются', () => {
    const feed = [feedItem('a', 'Аня', { is_bench_lift: true }, [{ weight: 0, reps: 0 }])]
    const { male } = computeBoardFromFeed(feed, new Map([['a', 'm']]))
    expect(male).toHaveLength(0)
  })
})

describe('getCachedLeaderboard (интеграция)', () => {
  let userId
  beforeEach(async () => {
    userId = uniqueUserId()
    await openUserDb(userId)
  })
  afterEach(async () => {
    await closeUserDb()
  })

  it('серверный снимок имеет приоритет', async () => {
    await db.leaderboard.bulkPut([
      { board: 'm', user_id: 'x', user_name: 'X', orm: 130, weight: 120, reps: 3, performed_at: '2026-01-01' },
      { board: 'm', user_id: 'y', user_name: 'Y', orm: 110, weight: 100, reps: 5, performed_at: '2026-01-01' },
    ])
    const { male } = await getCachedLeaderboard()
    expect(male.map((r) => r.user_id)).toEqual(['x', 'y'])
  })

  it('пустой снимок → фолбэк из кэша ленты + ростра', async () => {
    await loginDb.users.put({ id: userId, name: 'Я', sex: 'm' })
    await db.feed.put({
      id: 'w1', user_id: userId, user_name: 'Я', performed_at: '2026-05-01',
      entries: [{ is_bench_lift: true, sets: [{ weight: 95, reps: 5 }] }],
    })
    const { male } = await getCachedLeaderboard()
    expect(male.map((r) => r.user_id)).toContain(userId)
    expect(male[0].weight).toBe(95)
  })
})
