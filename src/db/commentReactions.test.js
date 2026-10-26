// Кэш реакций на мои комментарии (26.10.2026, fb_76d747a2): гарды (офлайн, чужая сессия, ошибка, смена учетки),
// запись только при изменении, контракт RPC.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ rpc: vi.fn(), session: true }))
vi.mock('./supabase.js', () => ({
  isConfigured: true,
  hasSession: vi.fn(async () => net.session),
  supabase: { rpc: (...a) => net.rpc(...a) },
}))
import { openUserDb, closeUserDb, db, getMeta } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { refreshCommentReactions, getCachedCommentReactions, commentReactionsKey } from './commentReactions.js'

const ROW = { comment_id: 'c1', workout_id: 'w1', body: 'сотка', user_id: 'olya', author_name: 'Оля', kind: 'fire', created_at: '2026-10-26T10:00:00Z' }
let user
beforeEach(async () => {
  user = uniqueUserId(); await openUserDb(user)
  net.rpc.mockReset().mockResolvedValue({ data: [ROW], error: null }); net.session = true
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(async () => { await closeUserDb(); vi.unstubAllGlobals() })

describe('refreshCommentReactions', () => {
  it('кладет реакции в кэш; контракт RPC — my_comment_reactions с лимитом', async () => {
    await refreshCommentReactions(user)
    expect(net.rpc).toHaveBeenCalledWith('my_comment_reactions', { p_limit: 40 })
    const list = await getCachedCommentReactions(user)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ type: 'comment_react', who: 'Оля', emoji: '🔥' })
  })
  it('без изменений meta не переписывается', async () => {
    await refreshCommentReactions(user)
    const spy = vi.spyOn(db.meta, 'put')
    await refreshCommentReactions(user)
    expect(spy).not.toHaveBeenCalled()
  })
  it('офлайн, чужая сессия, ошибка сервера — кэш как был', async () => {
    await refreshCommentReactions(user)
    net.rpc.mockResolvedValue({ data: [], error: null })
    vi.stubGlobal('navigator', { onLine: false })
    await refreshCommentReactions(user)
    vi.stubGlobal('navigator', { onLine: true })
    net.session = false
    await refreshCommentReactions(user)
    net.session = true
    net.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    await refreshCommentReactions(user)
    net.rpc.mockRejectedValue(new Error('сеть'))
    await refreshCommentReactions(user)
    expect(await getCachedCommentReactions(user)).toHaveLength(1)
  })
  it('сменилась учетка, пока шел запрос, — в чужую базу не пишем', async () => {
    let finish
    net.rpc.mockImplementation(() => new Promise((r) => { finish = r }))
    const req = refreshCommentReactions(user)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const other = uniqueUserId(); await openUserDb(other)
    finish({ data: [ROW], error: null }); await req
    expect(await getMeta(commentReactionsKey(user))).toBeUndefined()
    expect(await getCachedCommentReactions(other)).toEqual([])
  })
})
