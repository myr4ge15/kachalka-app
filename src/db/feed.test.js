// Тесты ленты (db/feed.js). Сеть (fetchFeed) не трогаем — покрываем чистую
// денормализацию серверной строки (rowToItem), расчет отметок рекордов в окне
// ленты (computePrs) и чтение кэша (getCachedFeed на fake-indexeddb).
import 'fake-indexeddb/auto' // ПЕРВЫМ: local.js создает Dexie на импорте
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { rowToItem, computePrs, baselineMap, getCachedFeed, carryComments, reactionsKey } from './feed.js'
import { overlayRecentComments, resetRecentComments } from './comments.js'

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

  // fb_b85b578b: 8 кг уже было до окна — кубка нет (бот тоже молчит).
  it('результат до окна (baseline) — повтор старого максимума не рекорд', () => {
    const items = [it_('w2', 'a', '2026-10-15', 8), it_('w1', 'a', '2026-10-11', 7)]
    computePrs(items, baselineMap([{ user_id: 'a', exercise_id: 'ex_bench', best: '8.00' }]))
    expect(items.find((i) => i.id === 'w2').prs).toEqual([])
  })

  it('baseline: первый замер в окне выше старого лучшего — рекорд', () => {
    const items = [it_('w1', 'a', '2026-10-11', 85)]
    computePrs(items, baselineMap([{ user_id: 'a', exercise_id: 'ex_bench', best: 80 }]))
    expect(items[0].prs).toEqual([expect.objectContaining({ value: 85 })])
  })

  it('нулевой подход не сбивает лучший результат и не считается замером', () => {
    const items = [it_('w3', 'a', '2026-03-01', 85), it_('w2', 'a', '2026-02-01', 0), it_('w1', 'a', '2026-01-01', 80)]
    computePrs(items)
    expect(items.find((i) => i.id === 'w2').prs).toEqual([])
    expect(items.find((i) => i.id === 'w3').prs).toEqual([expect.objectContaining({ value: 85 })])
  })

  it('baselineMap отбрасывает мусор', () => {
    const m = baselineMap([{ user_id: 'a', exercise_id: 'x', best: 0 }, { user_id: null, exercise_id: 'y', best: 5 }, { user_id: 'a', exercise_id: 'z', best: '7' }])
    expect([...m.get('a')]).toEqual([['z', 7]])
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

describe('комментарии в снимке ленты (19.10.2026)', () => {
  it('carryComments: свежим из сети элементам — комментарии прежнего снимка, свои не затирает', () => {
    const items = [{ id: 'w1', comments: [] }, { id: 'w2', comments: [{ id: 'new' }] }, { id: 'w3', comments: [] }]
    carryComments(items, [{ id: 'w1', comments: [{ id: 'old' }] }, { id: 'w2', comments: [{ id: 'old2' }] }])
    expect(items.map((i) => i.comments.map((c) => c.id))).toEqual([['old'], ['new'], []])
  })

  it('overlayRecentComments без свежих правок ничего не меняет', () => {
    resetRecentComments()
    const items = [{ id: 'w1', comments: [{ id: 'a' }] }]
    overlayRecentComments(items)
    expect(items[0].comments).toEqual([{ id: 'a' }])
  })
})

describe('reactionsKey (писать ли кэш Ленты)', () => {
  const item = (comment) => [{ id: 'w1', reactions: [], comments: [{ id: 'c1', name: 'Аня', body: 'огонь', ...comment }] }]

  it('смена вида реакции на комментарий меняет отпечаток, хотя счетчик и «моя есть» те же', () => {
    const heart = item({ like_count: 1, liked: false, reactions: { heart: 1 }, my_reaction: null })
    const fire = item({ like_count: 1, liked: false, reactions: { fire: 1 }, my_reaction: null })
    expect(reactionsKey(fire)).not.toBe(reactionsKey(heart))
  })

  it('своя реакция сменила вид — отпечаток другой', () => {
    const a = item({ like_count: 1, liked: true, reactions: { heart: 1 }, my_reaction: 'heart' })
    const b = item({ like_count: 1, liked: true, reactions: { laugh: 1 }, my_reaction: 'laugh' })
    expect(reactionsKey(b)).not.toBe(reactionsKey(a))
  })

  it('порядок ключей и нулевые виды не дают ложной перезаписи', () => {
    const a = item({ reactions: { heart: 2, fire: 1 } })
    const b = item({ reactions: { fire: 1, heart: 2, wow: 0 } })
    expect(reactionsKey(b)).toBe(reactionsKey(a))
  })
})
