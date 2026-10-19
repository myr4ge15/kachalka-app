import { describe, expect, it } from 'vitest'
import {
  canDeleteComment, canEditComment, canLikeComment, toggleLike, cleanBody, commentAgo, groupComments, normComment, previewComments, upsertComment,
} from './comments.js'

const row = (id, at, extra = {}) => ({
  id, workout_id: 'w1', user_id: 'u1', author_name: 'Аня', author_known: true,
  author_avatar_url: 'https://x/a.jpg', body: id, created_at: at, ...extra,
})

describe('comments', () => {
  it('строка сервера: незнакомому автору фото не показываем, пустое имя — «Кто-то»', () => {
    expect(normComment(row('c1', '2026-10-19T10:00:00Z'))).toMatchObject({ name: 'Аня', known: true, avatar_url: 'https://x/a.jpg' })
    const unknown = normComment(row('c2', '2026-10-19T10:00:00Z', { author_known: false, author_name: ' ' }))
    expect(unknown).toMatchObject({ name: 'Кто-то', known: false, avatar_url: null })
    expect(normComment({ id: 'x' })).toBeNull()
  })

  it('группировка по тренировке и порядок по времени', () => {
    const g = groupComments([row('b', '2026-10-19T11:00:00Z'), row('a', '2026-10-19T10:00:00Z'),
      row('z', '2026-10-19T09:00:00Z', { workout_id: 'w2' }), null])
    expect(g.get('w1').map((c) => c.id)).toEqual(['a', 'b'])
    expect(g.get('w2').map((c) => c.id)).toEqual(['z'])
  })

  it('upsert заменяет по id и держит порядок', () => {
    const a = normComment(row('a', '2026-10-19T10:00:00Z'))
    const b = normComment(row('b', '2026-10-19T11:00:00Z'))
    expect(upsertComment([b], a).map((c) => c.id)).toEqual(['a', 'b'])
    expect(upsertComment([a, b], { ...a, body: 'новое' })).toHaveLength(2)
  })

  it('превью: два последних и сколько скрыто; раскрыто — все', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
    expect(previewComments(list, false)).toEqual({ shown: [{ id: 'c' }, { id: 'd' }], hidden: 2 })
    expect(previewComments(list, true)).toEqual({ shown: list, hidden: 0 })
    expect(previewComments(list.slice(0, 2), false).hidden).toBe(0)
  })

  it('удалить: свой комментарий или любой под своей тренировкой', () => {
    expect(canDeleteComment({ user_id: 'me' }, 'me', 'owner')).toBe(true)
    expect(canDeleteComment({ user_id: 'x' }, 'me', 'me')).toBe(true)
    expect(canDeleteComment({ user_id: 'x' }, 'me', 'owner')).toBe(false)
    expect(canDeleteComment({ user_id: 'me' }, null, 'owner')).toBe(false)
  })

  it('короткое время', () => {
    const now = Date.parse('2026-10-19T12:00:00Z')
    expect(commentAgo('2026-10-19T11:59:30Z', now)).toBe('сейчас')
    expect(commentAgo('2026-10-19T11:20:00Z', now)).toBe('40 мин')
    expect(commentAgo('2026-10-19T09:00:00Z', now)).toBe('3 ч')
    expect(commentAgo('2026-10-17T12:00:00Z', now)).toBe('2 дн')
    expect(commentAgo('2026-09-01T12:00:00Z', now)).toMatch(/^1 сент/)
    expect(commentAgo(null, now)).toBe('')
  })

  it('текст поля обрезается по краям', () => {
    expect(cleanBody('  ого, сотка \n')).toBe('ого, сотка')
    expect(cleanBody(null)).toBe('')
  })

  it('9.5.3: правка, ❤️ и поля с сервера', () => {
    expect(normComment(row('c1', '2026-10-19T10:00:00Z'))).toMatchObject({ edited_at: null, like_count: 0, liked: false })
    expect(normComment(row('c1', '2026-10-19T10:00:00Z', { edited_at: 'e', like_count: '3', liked: true })))
      .toMatchObject({ edited_at: 'e', like_count: 3, liked: true })
    expect(canEditComment({ user_id: 'me' }, 'me')).toBe(true)
    expect(canEditComment({ user_id: 'x' }, 'me')).toBe(false)
    expect(canEditComment({ user_id: 'me' }, null)).toBe(false)
    expect(canLikeComment({ user_id: 'x' }, 'me')).toBe(true)
    expect(canLikeComment({ user_id: 'me' }, 'me')).toBe(false)
    expect(toggleLike({ like_count: 2, liked: false }, true)).toEqual({ like_count: 3, liked: true })
    expect(toggleLike({ like_count: 3, liked: true }, false)).toEqual({ like_count: 2, liked: false })
    expect(toggleLike({ like_count: 0, liked: true }, false)).toEqual({ like_count: 0, liked: false })
    expect(toggleLike({ like_count: 1, liked: true }, true)).toEqual({ like_count: 1, liked: true })
  })
})
