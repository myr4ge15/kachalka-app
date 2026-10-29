// fetchFeed на реальном Dexie (fake-indexeddb) и замоканном Supabase: при
// неизменном окне ленты и тех же реакциях кэш не перезаписывается (иначе каждый
// поллинг будил все useLiveQuery по ленте), а новая реакция — записывается.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const server = vi.hoisted(() => ({ workouts: [], reactions: [], session: 'u', onReactions: null, rpc: null, rpcCalls: [] }))

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
        if (table === 'reactions') {
          res = { data: server.reactions, error: null }
          // гонка: снимок реакций уже снят, а push тем временем отправил и удалил операцию
          if (server.onReactions) return server.onReactions().then(() => res).then(ok, fail)
        } else if (b.selection === 'id, updated_at') res = { data: server.workouts.map(({ id, updated_at }) => ({ id, updated_at })), error: null }
        else res = { data: server.workouts, error: null }
        return Promise.resolve(res).then(ok, fail)
      },
    }
    return b
  }
  // RPC окна Ленты: comments_for, feed_pr_baseline, my_comment_reactions. Без обработчика — ошибка сервера.
  async function rpc(name, args) {
    server.rpcCalls.push({ name, args })
    return server.rpc ? server.rpc(name, args) : { data: null, error: { message: 'no function' } }
  }
  return {
    supabase: { from, rpc },
    isConfigured: true,
    hasSession: async (userId) => !userId || userId === server.session,
  }
})

import { openUserDb, closeUserDb, db, setMeta } from './local.js'
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
  server.onReactions = null
  server.rpc = null
  server.rpcCalls = []
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

  it('справочник изменился (переименование/слияние) — лента перекачивается при том же окне (v8.2.1)', async () => {
    server.workouts[0].workout_exercises = [{ id: 'we1', position: 0, exercise_id: 'e1', exercise: { id: 'e1', name: 'Приседания на скамейку', metric: 'weight' }, sets: [] }]
    await fetchFeed(userId, db)
    expect((await db.feed.get('w1')).entries[0].name).toBe('Приседания на скамейку')
    // Сервер: упражнение слили, тренировка та же (updated_at не сдвинут).
    server.workouts[0].workout_exercises[0] = { ...server.workouts[0].workout_exercises[0], exercise_id: 'e2', exercise: { id: 'e2', name: 'Приседания на опору', metric: 'weight' } }
    await fetchFeed(userId, db)
    expect((await db.feed.get('w1')).entries[0].name).toBe('Приседания на скамейку') // справочник еще не тянули
    await setMeta('sig_exercises', 'e1,e2|2026-10-14T08:00:00Z', db) // pull справочника увидел правку
    await fetchFeed(userId, db)
    expect((await db.feed.get('w1')).entries[0].name).toBe('Приседания на опору')
  })

  it('новая реакция при том же окне — записывается', async () => {
    await fetchFeed(userId, db)
    server.reactions = [...server.reactions, { workout_id: 'w1', user_id: 'y', kind: 'strong', created_at: '2026-07-28T12:00:00.000Z', user: { name: 'Игрек' } }]

    await fetchFeed(userId, db)

    expect((await db.feed.get('w1')).reactions).toHaveLength(2)
  })

  it('мой тап, отправленный во время запроса, не пропадает из кэша (fb_53077e01)', async () => {
    await fetchFeed(userId, db)
    await db.reaction_outbox.add({ workoutId: 'w1', kind: 'clap', op: 'add', createdAt: '2026-07-28T12:00:00.000Z' })
    // сервер ответил снимком без моей реакции, а очередь за это время опустела
    server.onReactions = () => db.reaction_outbox.clear()

    await fetchFeed(userId, db)

    const mine = (await db.feed.get('w1')).reactions.filter((r) => r.user_id === userId)
    expect(mine).toMatchObject([{ kind: 'clap' }])
  })

  it('под сессией другой учетки ленту не трогает', async () => {
    server.session = 'someone-else'

    await fetchFeed(userId, db)

    expect(await db.feed.count()).toBe(0)
  })
})

describe('fetchFeed — комментарии окна (comments_for)', () => {
  const comment = (over = {}) => ({
    id: 'c1', workout_id: 'w1', user_id: 'x', author_name: 'Икс', author_known: true, author_avatar_url: 'https://a/x.jpg',
    body: 'Огонь', created_at: '2026-07-28T12:00:00.000Z', ...over,
  })
  const rpcWith = (rows) => (name) => (name === 'comments_for' ? { data: rows, error: null } : { data: [], error: null })

  it('один вызов на все карточки окна; комментарии ложатся в свои карточки', async () => {
    server.workouts.push({ id: 'w2', user_id: 'friend', performed_at: '2026-07-27', updated_at: '2026-07-27T10:00:00.000Z',
      user: { id: 'friend', name: 'Дима' }, workout_exercises: [] })
    server.rpc = rpcWith([comment(), comment({ id: 'c0', body: 'Первый', created_at: '2026-07-28T11:00:00.000Z' })])

    await fetchFeed(userId, db)

    expect(server.rpcCalls.filter((c) => c.name === 'comments_for')).toEqual([
      { name: 'comments_for', args: { p_workout_ids: ['w1', 'w2'] } },
    ])
    expect((await db.feed.get('w1')).comments).toMatchObject([
      { id: 'c0', body: 'Первый' },
      { id: 'c1', body: 'Огонь', name: 'Икс', known: true, avatar_url: 'https://a/x.jpg' },
    ])
    expect((await db.feed.get('w2')).comments).toEqual([])
  })

  it('сервер не отдал комментарии — у карточки остаются прежние', async () => {
    server.rpc = rpcWith([comment()])
    await fetchFeed(userId, db)
    server.workouts[0].updated_at = '2026-07-28T13:00:00.000Z' // окно изменилось → тяжелый запрос
    server.rpc = (name) => (name === 'comments_for' ? { data: null, error: { message: 'timeout' } } : { data: [], error: null })

    await fetchFeed(userId, db)

    expect((await db.feed.get('w1')).comments).toMatchObject([{ id: 'c1', body: 'Огонь' }])
  })
})

describe('fetchFeed — кубки с учетом результатов до окна (feed_pr_baseline)', () => {
  const lift = (id, day, weight) => ({
    id, user_id: 'friend', performed_at: day, updated_at: `${day}T10:00:00.000Z`, user: { id: 'friend', name: 'Дима' },
    workout_exercises: [{ id: 'we_' + id, position: 0, exercise_id: 'e1', exercise: { id: 'e1', name: 'Жим', metric: 'weight' },
      sets: [{ id: 's_' + id, set_number: 0, weight, reps: 5 }] }],
  })
  beforeEach(() => { server.workouts = [lift('w2', '2026-07-28', 80), lift('w1', '2026-07-20', 70)] })

  it('запрос — от самой ранней тренировки окна и по ее авторам; старый лучший результат гасит ложный кубок', async () => {
    server.rpc = (name) => (name === 'feed_pr_baseline'
      ? { data: [{ user_id: 'friend', exercise_id: 'e1', best: 90 }], error: null }
      : { data: [], error: null })

    await fetchFeed(userId, db)

    expect(server.rpcCalls.find((c) => c.name === 'feed_pr_baseline').args).toEqual({ p_before: '2026-07-20', p_user_ids: ['friend'] })
    expect((await db.feed.get('w2')).prs).toEqual([])
    expect((await db.feed.get('w1')).prs).toEqual([])
  })

  it('результат выше старого лучшего — кубок, в том числе у первой тренировки окна', async () => {
    server.rpc = (name) => (name === 'feed_pr_baseline'
      ? { data: [{ user_id: 'friend', exercise_id: 'e1', best: 65 }], error: null }
      : { data: [], error: null })

    await fetchFeed(userId, db)

    expect((await db.feed.get('w1')).prs).toEqual([{ name: 'Жим', metric: 'weight', value: 70 }])
    expect((await db.feed.get('w2')).prs).toEqual([{ name: 'Жим', metric: 'weight', value: 80 }])
  })

  it('сервер без функции — кубки по окну, как раньше', async () => {
    await fetchFeed(userId, db)

    expect((await db.feed.get('w1')).prs).toEqual([])
    expect((await db.feed.get('w2')).prs).toEqual([{ name: 'Жим', metric: 'weight', value: 80 }])
  })
})
