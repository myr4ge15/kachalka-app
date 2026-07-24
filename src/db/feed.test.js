// Тесты ленты (db/feed.js). Сеть (fetchFeed) не трогаем — покрываем чистую
// денормализацию серверной строки (rowToItem), расчёт отметок рекордов в окне
// ленты (computePrs) и чтение кэша (getCachedFeed на fake-indexeddb).
import 'fake-indexeddb/auto' // ПЕРВЫМ: local.js создаёт Dexie на импорте
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { rowToItem, computePrs, getCachedFeed } from './feed.js'

describe('rowToItem (денормализация серверной строки)', () => {
  const row = {
    id: 'w1', performed_at: '2026-05-01', user_id: 'u1',
    user: { id: 'u1', name: 'Петя' },
    workout_exercises: [
      {
        id: 'we2', position: 1, exercise_id: 'ex_row',
        exercise: { id: 'ex_row', name: 'Тяга', muscle_group: 'спина', metric: 'weight' },
        sets: [{ set_number: 1, weight: 70, reps: 10 }],
      },
      {
        id: 'we1', position: 0, exercise_id: 'ex_bench',
        exercise: { id: 'ex_bench', name: 'Жим', muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' },
        sets: [{ set_number: 2, weight: 100, reps: 5 }, { set_number: 1, weight: 90, reps: 8 }],
      },
    ],
  }

  it('сортирует упражнения по position и подходы по set_number', () => {
    const item = rowToItem(row)
    expect(item.entries.map((e) => e.exercise_id)).toEqual(['ex_bench', 'ex_row'])
    expect(item.entries[0].sets.map((s) => s.weight)).toEqual([90, 100]) // set_number 1,2
  })

  it('считает сводку: упражнения/подходы/тоннаж', () => {
    const item = rowToItem(row)
    expect(item.exCount).toBe(2)
    expect(item.setCount).toBe(3)
    // 90*8 + 100*5 + 70*10 = 720 + 500 + 700 = 1920
    expect(item.tonnage).toBe(1920)
  })

  it('фолбэки: имя автора и пустые поля', () => {
    const item = rowToItem({ id: 'w2', performed_at: '2026-05-02', user_id: 'u9', workout_exercises: [] })
    expect(item.user_name).toBe('Кто-то')
    expect(item.entries).toEqual([])
    expect(item.prs).toEqual([])
  })
})

describe('computePrs (отметки рекордов в окне)', () => {
  const it_ = (id, user_id, at, value) => ({
    id, user_id, performed_at: at,
    entries: [{ exercise_id: 'ex_bench', name: 'Жим', metric: 'weight', sets: [{ weight: value, reps: 5 }] }],
    prs: [],
  })

  it('превышение прежнего максимума автора → рекорд; первый замер — нет', () => {
    const items = [it_('w2', 'a', '2026-02-01', 90), it_('w1', 'a', '2026-01-01', 80)]
    computePrs(items)
    const first = items.find((i) => i.id === 'w1')
    const second = items.find((i) => i.id === 'w2')
    expect(first.prs).toEqual([]) // нечего бить
    expect(second.prs).toHaveLength(1)
    expect(second.prs[0]).toMatchObject({ metric: 'weight', value: 90 })
  })

  it('рекорды разных авторов независимы', () => {
    const items = [
      it_('a1', 'a', '2026-01-01', 80),
      it_('a2', 'a', '2026-02-01', 85),
      it_('b1', 'b', '2026-01-15', 200), // первый для b — не рекорд
    ]
    computePrs(items)
    expect(items.find((i) => i.id === 'a2').prs).toHaveLength(1)
    expect(items.find((i) => i.id === 'b1').prs).toEqual([])
  })
})

describe('getCachedFeed (кэш, свежее сверху)', () => {
  let userId
  beforeEach(async () => {
    userId = uniqueUserId()
    await openUserDb(userId)
  })
  afterEach(async () => {
    await closeUserDb()
  })

  it('возвращает элементы ленты, отсортированные по дате убывающе', async () => {
    await db.feed.bulkPut([
      { id: 'w_old', performed_at: '2026-01-01', user_id: 'u1' },
      { id: 'w_new', performed_at: '2026-05-01', user_id: 'u2' },
      { id: 'w_mid', performed_at: '2026-03-01', user_id: 'u3' },
    ])
    const feed = await getCachedFeed()
    expect(feed.map((f) => f.id)).toEqual(['w_new', 'w_mid', 'w_old'])
  })

  it('пустой кэш → пустой массив', async () => {
    expect(await getCachedFeed()).toEqual([])
  })
})
