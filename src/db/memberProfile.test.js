// db/memberProfile.js — витрина профиля участника (до v6.14.2 без тестов, замер
// покрытия 06.10: 0%): снимок из кэша/ленты с наложением неотправленных реакций,
// оптимистичный тап реакции, подтягивание с сервера в кэш. Реальный Dexie поверх
// fake-indexeddb; сервер — заглушка PostgREST-билдера.
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const toggleReaction = vi.fn(async () => {})
vi.mock('./repo.js', () => ({ toggleReaction: (...a) => toggleReaction(...a) }))

let hasSessionValue = true
const calls = []
let results = {}
// Билдер PostgREST: любые .eq/.order/.limit/.in возвращают его же; await — результат.
function builder(table, selectArgs) {
  const key = table === 'workouts' && selectArgs[1]?.head ? 'count' : table
  calls.push({ table, select: selectArgs, chain: [] })
  const me = calls.at(-1)
  const b = {
    eq: (...a) => { me.chain.push(['eq', ...a]); return b },
    order: (...a) => { me.chain.push(['order', ...a]); return b },
    limit: (...a) => { me.chain.push(['limit', ...a]); return b },
    in: (...a) => { me.chain.push(['in', ...a]); return b },
    abortSignal: () => b,
    then: (ok, fail) => Promise.resolve(results[key]).then(ok, fail),
  }
  return b
}
vi.mock('./supabase.js', () => ({
  isConfigured: true,
  hasSession: async () => hasSessionValue,
  supabase: { from: (table) => ({ select: (...a) => builder(table, a) }) },
}))

const local = await import('./local.js')
const { openUserDb, closeUserDb, getMeta, setMeta } = local
const { memberKey, getCachedMember, toggleMemberReaction, fetchMember } = await import('./memberProfile.js')
const { uniqueUserId } = await import('../test/idbHarness.js')

const me = { id: 'me', name: 'Я' }
const item = (id, user_id, reactions = []) => ({ id, user_id, performed_at: '2026-10-01T10:00:00Z', entries: [], reactions })
const row = (id, performed_at, weight) => ({
  id, performed_at, user_id: 'm1', user: { id: 'm1', name: 'Маша' },
  workout_exercises: [{ id: 'we' + id, position: 0, exercise_id: 'bench',
    exercise: { id: 'bench', name: 'Жим', muscle_group: 'грудь', metric: 'weight' },
    sets: [{ id: 's' + id, set_number: 1, weight, reps: 5 }] }],
})

beforeEach(async () => {
  await openUserDb(uniqueUserId())
  calls.length = 0
  results = {}
  hasSessionValue = true
  toggleReaction.mockClear()
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(async () => { vi.unstubAllGlobals(); await closeUserDb() })

describe('getCachedMember', () => {
  it('нет базы или id — null; нет ни кэша, ни ленты — null', async () => {
    expect(await getCachedMember(null)).toBeNull()
    expect(await getCachedMember('m1', me, null)).toBeNull()
    expect(await getCachedMember('m1', me)).toBeNull()
  })

  it('кэша нет — тренировки участника из ленты (source: feed)', async () => {
    await local.db.feed.bulkPut([item('a', 'm1'), item('b', 'other'), item('c', 'm1')])
    const snap = await getCachedMember('m1')
    expect(snap.source).toBe('feed')
    expect(snap.items.map((i) => i.id).sort()).toEqual(['a', 'c'])
    expect(snap).toMatchObject({ at: null, total: null })
  })

  it('кэш важнее ленты; поверх — мои неотправленные реакции', async () => {
    await local.db.feed.put(item('old', 'm1'))
    await setMeta(memberKey('m1'), { at: 5, total: 7, items: [item('w1', 'm1', [{ user_id: 'me', name: 'Я', kind: 'fire' }])] })
    await local.db.reaction_outbox.bulkAdd([
      { workoutId: 'w1', kind: 'clap', op: 'add', createdAt: 't' },
      { workoutId: 'w1', kind: 'fire', op: 'remove', createdAt: 't' },
    ])
    const snap = await getCachedMember('m1', me)
    expect(snap).toMatchObject({ source: 'cache', at: 5, total: 7 })
    expect(snap.items[0].reactions).toEqual([{ user_id: 'me', name: 'Я', kind: 'clap' }])
    // без зрителя очередь не накладывается
    expect((await getCachedMember('m1')).items[0].reactions).toEqual([{ user_id: 'me', name: 'Я', kind: 'fire' }])
  })
})

describe('toggleMemberReaction', () => {
  it('пишет в общую очередь и сразу правит снимок профиля', async () => {
    await setMeta(memberKey('m1'), { at: 1, total: 1, items: [item('w1', 'm1')] })
    await toggleMemberReaction({ userId: 'me', userName: 'Я', memberId: 'm1', workoutId: 'w1', kind: 'muscle', mine: false })
    expect(toggleReaction).toHaveBeenCalledWith({ userId: 'me', userName: 'Я', workoutId: 'w1', kind: 'muscle', mine: false })
    expect((await getMeta(memberKey('m1'))).items[0].reactions).toEqual([{ user_id: 'me', name: 'Я', kind: 'muscle' }])

    await toggleMemberReaction({ userId: 'me', userName: 'Я', memberId: 'm1', workoutId: 'w1', kind: 'muscle', mine: true })
    expect((await getMeta(memberKey('m1'))).items[0].reactions).toEqual([])
  })

  it('снимка нет — только очередь, кэш не создается', async () => {
    await toggleMemberReaction({ userId: 'me', userName: 'Я', memberId: 'm1', workoutId: 'w1', kind: 'wow', mine: false })
    expect(toggleReaction).toHaveBeenCalledOnce()
    expect(await getMeta(memberKey('m1'))).toBeUndefined()
  })
})

describe('fetchMember', () => {
  it('офлайн, без id или без своей сессии — тихо false, без запросов', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(await fetchMember('me', 'm1')).toBe(false)
    vi.stubGlobal('navigator', { onLine: true })
    expect(await fetchMember('me', null)).toBe(false)
    hasSessionValue = false
    expect(await fetchMember('me', 'm1')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('успех: окно участника + счетчик + реакции + отметки рекордов → кэш', async () => {
    results = {
      workouts: { data: [row('w2', '2026-10-03T10:00:00Z', 70), row('w1', '2026-10-01T10:00:00Z', 60)], error: null },
      count: { count: 42, error: null },
      reactions: { data: [{ workout_id: 'w2', user_id: 'me', kind: 'fire', user: { name: 'Я' } }], error: null },
    }
    expect(await fetchMember('me', 'm1')).toBe(true)
    const list = calls.find((c) => c.table === 'workouts' && !c.select[1])
    expect(list.chain).toEqual(expect.arrayContaining([['eq', 'user_id', 'm1'], ['limit', 60]]))
    const snap = await getMeta(memberKey('m1'))
    expect(snap.total).toBe(42)
    expect(typeof snap.at).toBe('number')
    expect(snap.items.map((i) => i.id)).toEqual(['w2', 'w1'])
    expect(snap.items[0].reactions).toEqual([expect.objectContaining({ user_id: 'me', kind: 'fire', name: 'Я' })])
    expect(snap.items[0].prs?.length ?? 0).toBeGreaterThan(0) // 70 > 60 — рекорд в окне
  })

  it('счетчик упал — total null; реакции упали — карточки без них', async () => {
    results = {
      workouts: { data: [row('w1', '2026-10-01T10:00:00Z', 60)], error: null },
      count: { count: null, error: { message: 'x' } },
      reactions: { data: null, error: { message: 'нет таблицы' } },
    }
    expect(await fetchMember('me', 'm1')).toBe(true)
    const snap = await getMeta(memberKey('m1'))
    expect(snap.total).toBeNull()
    expect(snap.items).toHaveLength(1)
  })

  it('ошибка списка — бросает (экран покажет плашку), кэш не трогает', async () => {
    await setMeta(memberKey('m1'), { at: 1, total: 1, items: [] })
    results = { workouts: { data: null, error: new Error('RLS') }, count: { count: 0, error: null } }
    await expect(fetchMember('me', 'm1')).rejects.toThrow('RLS')
    expect((await getMeta(memberKey('m1'))).at).toBe(1)
  })
})
