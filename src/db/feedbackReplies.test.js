// Кэш ответов разработчика для «Уведомлений» (v6.12.0): Dexie поверх fake-indexeddb.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeUserDb, openUserDb } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { cacheFeedbackReplies, getCachedFeedbackReplies } from './feedbackReplies.js'
import { countUnread, getNotifications } from './notifications.js'

const ROWS = [
  { id: 'f1', status: 'resolved', reply: 'Исправлено', reply_photos: 0, replied_at: '2026-10-05T12:00:00Z' },
  { id: 'f2', status: 'resolved', reply: null, reply_photos: 2, replied_at: '2026-10-05T13:00:00Z' },
  { id: 'f3', status: 'new', reply: null, reply_photos: 0, replied_at: null },
]

let userId
beforeEach(async () => { userId = uniqueUserId(); await openUserDb(userId) })
afterEach(async () => { await closeUserDb() })

describe('feedbackReplies', () => {
  it('кладет только обращения с ответом (текст или фото) и отдает их в «Уведомления»', async () => {
    await cacheFeedbackReplies(userId, ROWS)
    const cached = await getCachedFeedbackReplies(userId)
    expect(cached.map((n) => n.feedbackId)).toEqual(['f1', 'f2'])
    const list = await getNotifications(userId)
    const fb = list.filter((n) => n.type === 'feedback')
    expect(fb.map((n) => n.id)).toEqual(['feedback:f2', 'feedback:f1']) // свежие сверху
    expect(fb[0]).toMatchObject({ photos: 2, text: '' })
    expect(await countUnread(userId)).toBe(2) // колокольчик знает об ответах
  })

  it('свежий снимок заменяет прежний; мусор и чужая база — без записи', async () => {
    await cacheFeedbackReplies(userId, ROWS)
    await cacheFeedbackReplies(userId, [ROWS[0]])
    expect((await getCachedFeedbackReplies(userId)).length).toBe(1)
    await cacheFeedbackReplies(userId, null)
    expect((await getCachedFeedbackReplies(userId)).length).toBe(1)
    await cacheFeedbackReplies('someone-else', ROWS) // запрос другой учетки дорезолвился после входа этой
    expect(await getCachedFeedbackReplies('someone-else')).toEqual([])
  })

  it('без базы (вышли из учетки) — тихо пусто', async () => {
    await closeUserDb()
    await expect(cacheFeedbackReplies(userId, ROWS)).resolves.toBeUndefined()
    expect(await getCachedFeedbackReplies(userId)).toEqual([])
  })
})
