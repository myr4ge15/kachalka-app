// Обвязка кэша комментариев (db/comments.js) на fake-indexeddb: после отправки, правки, ❤️
// и удаления снимки Ленты и профиля участника меняются сразу, свежие правки накладываются
// на опоздавший ответ сервера (покрытие тестами 20.10.2026: было 26 % строк).
import '../test/idbHarness.js' // ПЕРВЫМ: fake-indexeddb до Dexie
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeUserDb, openUserDb, db, getMeta, setMeta } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'

const api = vi.hoisted(() => ({}))
vi.mock('../lib/comments.js', async (orig) => ({
  ...(await orig()),
  addComment: (...a) => api.addComment(...a),
  editComment: (...a) => api.editComment(...a),
  likeComment: (...a) => api.likeComment(...a),
  deleteComment: (...a) => api.deleteComment(...a),
}))
const { postComment, updateComment, setCommentLike, removeComment, overlayRecentComments, resetRecentComments } =
  await import('./comments.js')

const OLD = { id: 'c0', workout_id: 'w1', body: 'старый', created_at: '2026-10-19T09:00:00Z', like_count: 0, liked: false }
const NEW = { id: 'c1', workout_id: 'w1', body: 'новый', created_at: '2026-10-19T10:00:00Z', like_count: 0, liked: false }

beforeEach(async () => {
  await openUserDb(uniqueUserId())
  resetRecentComments()
  Object.assign(api, {
    addComment: vi.fn(async () => NEW),
    editComment: vi.fn(async () => ({ body: 'исправил', edited_at: '2026-10-19T11:00:00Z' })),
    likeComment: vi.fn(async () => ({ like_count: 1, liked: true })),
    deleteComment: vi.fn(async () => true),
  })
  await db.feed.put({ id: 'w1', user_id: 'owner', comments: [OLD] })
  await setMeta('member_owner', { items: [{ id: 'w1', comments: [OLD] }, { id: 'w2', comments: [] }] }, db)
})
afterEach(async () => { await closeUserDb() })

const feedComments = async () => (await db.feed.get('w1')).comments
const memberComments = async () => (await getMeta('member_owner', db)).items.find((i) => i.id === 'w1').comments

describe('db/comments', () => {
  it('отправка: комментарий сразу в Ленте и в профиле автора тренировки', async () => {
    const c = await postComment({ userId: 'me', workoutId: 'w1', ownerId: 'owner', text: 'новый', replyTo: { id: 'c0' } })
    expect(c).toBe(NEW)
    expect(api.addComment).toHaveBeenCalledWith('me', 'w1', 'новый', 'c0')
    expect((await feedComments()).map((x) => x.id)).toEqual(['c0', 'c1'])
    expect((await memberComments()).map((x) => x.id)).toEqual(['c0', 'c1'])
  })

  it('опрос, ушедший до отправки, не «съедает» новый комментарий', async () => {
    await postComment({ userId: 'me', workoutId: 'w1', ownerId: 'owner', text: 'новый' })
    const stale = [{ id: 'w1', comments: [OLD] }, { id: 'w9', comments: [] }]
    overlayRecentComments(stale)
    expect(stale[0].comments.map((x) => x.id)).toEqual(['c0', 'c1'])
    expect(stale[1].comments).toEqual([])
  })

  it('правка и ❤️ — полями поверх, остальное не трогаем; поверх опоздавшего ответа тоже', async () => {
    await updateComment({ userId: 'me', comment: OLD, ownerId: 'owner', text: 'исправил' })
    await setCommentLike({ userId: 'me', comment: OLD, ownerId: 'owner', on: true })
    expect(api.likeComment).toHaveBeenCalledWith('me', 'c0', true)
    expect((await feedComments())[0]).toMatchObject({ id: 'c0', body: 'исправил', like_count: 1, liked: true, created_at: OLD.created_at })
    expect((await memberComments())[0]).toMatchObject({ body: 'исправил', liked: true })
    const stale = [{ id: 'w1', comments: [OLD] }]
    overlayRecentComments(stale)
    expect(stale[0].comments[0]).toMatchObject({ body: 'исправил', edited_at: '2026-10-19T11:00:00Z', like_count: 1 })
  })

  it('удаление убирает из кэшей и из опоздавшего ответа; отменяет недавнюю отправку', async () => {
    await postComment({ userId: 'me', workoutId: 'w1', ownerId: 'owner', text: 'новый' })
    await removeComment({ userId: 'me', comment: NEW, ownerId: 'owner' })
    await removeComment({ userId: 'me', comment: OLD, ownerId: 'owner' })
    expect(await feedComments()).toEqual([])
    expect(await memberComments()).toEqual([])
    const stale = [{ id: 'w1', comments: [OLD, NEW] }]
    overlayRecentComments(stale)
    expect(stale[0].comments).toEqual([])
  })

  it('свежие правки живут 2 минуты, потом верим серверу', async () => {
    await postComment({ userId: 'me', workoutId: 'w1', ownerId: 'owner', text: 'новый' })
    const stale = [{ id: 'w1', comments: [OLD] }]
    overlayRecentComments(stale, Date.now() + 3 * 60 * 1000)
    expect(stale[0].comments.map((x) => x.id)).toEqual(['c0'])
  })

  it('без профиля участника в кэше и без ownerId — правится только Лента', async () => {
    await postComment({ userId: 'me', workoutId: 'w1', ownerId: null, text: 'новый' })
    expect((await memberComments()).map((x) => x.id)).toEqual(['c0'])
    await postComment({ userId: 'me', workoutId: 'w1', ownerId: 'nobody', text: 'новый' })
    expect(await getMeta('member_nobody', db)).toBeFalsy()
  })

  it('ошибка сервера — кэши не трогаем, ошибку отдаем экрану', async () => {
    api.addComment.mockRejectedValue(new Error('Слишком много комментариев'))
    await expect(postComment({ userId: 'me', workoutId: 'w1', ownerId: 'owner', text: 'x' })).rejects.toThrow('Слишком много')
    expect((await feedComments()).map((x) => x.id)).toEqual(['c0'])
  })
})
