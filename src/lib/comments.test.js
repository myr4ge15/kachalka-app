import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canDeleteComment, canEditComment, canReactComment, canReplyComment, replyQuote, applyReaction, nextReaction, reactionPills, COMMENT_REACTIONS, cleanBody, commentAgo, commentClock, commentDayBreaks, commentDayLabel, commentSeries, isDoubleTap, DOUBLE_TAP_MS, groupComments, nameTone, NAME_TONES, normComment, previewComments, upsertComment,
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
      .toMatchObject({ edited_at: 'e', like_count: 3, liked: true, reactions: { heart: 3 }, my_reaction: 'heart' })
    // Реакции с сервера (20261020160000): неизвестные виды и нули отброшены; сервер без реакций — все лайки сердца.
    expect(normComment(row('c1', '2026-10-19T10:00:00Z', { reactions: { laugh: 2, fire: '1', poop: 5, wow: 0 }, my_reaction: 'laugh' })))
      .toMatchObject({ reactions: { laugh: 2, fire: 1 }, my_reaction: 'laugh' })
    expect(normComment(row('c1', '2026-10-19T10:00:00Z', { reactions: {}, my_reaction: 'poop', liked: true })))
      .toMatchObject({ reactions: {}, my_reaction: null })
    expect(canEditComment({ user_id: 'me' }, 'me')).toBe(true)
    expect(canEditComment({ user_id: 'x' }, 'me')).toBe(false)
    expect(canEditComment({ user_id: 'me' }, null)).toBe(false)
    expect(canReactComment({ user_id: 'x' }, 'me')).toBe(true)
    expect(canReactComment({ user_id: 'me' }, 'me')).toBe(false)
    // одна реакция от человека: новая заменяет прежнюю, та же — снимает
    expect(applyReaction({ reactions: { heart: 2 }, my_reaction: null }, 'heart'))
      .toEqual({ reactions: { heart: 3 }, my_reaction: 'heart', like_count: 3, liked: true })
    expect(applyReaction({ reactions: { heart: 1, laugh: 2 }, my_reaction: 'heart' }, 'laugh'))
      .toEqual({ reactions: { laugh: 3 }, my_reaction: 'laugh', like_count: 3, liked: true })
    expect(applyReaction({ reactions: { laugh: 1 }, my_reaction: 'laugh' }, null))
      .toEqual({ reactions: {}, my_reaction: null, like_count: 0, liked: false })
    expect(applyReaction({}, 'poop')).toEqual({ reactions: {}, my_reaction: null, like_count: 0, liked: false })
    expect(nextReaction({ my_reaction: 'fire' }, 'fire')).toBe(null)
    expect(nextReaction({ my_reaction: 'fire' }, 'wow')).toBe('wow')
    // таблетки — в порядке набора, только с реакциями
    expect(reactionPills({ reactions: { wow: 1, heart: 2 }, my_reaction: 'wow' }).map((p) => [p.emoji, p.count, p.mine]))
      .toEqual([['❤️', 2, false], ['😮', 1, true]])
    expect(COMMENT_REACTIONS.map((r) => r.kind)).toEqual(['heart', 'laugh', 'like', 'fire', 'wow'])
  })

  it('ответ: поля с сервера, кому можно ответить, цитата', () => {
    expect(normComment(row('c1', '2026-10-19T10:00:00Z'))).toMatchObject({ reply_to: null, reply_to_user: null, reply_to_name: null })
    expect(normComment(row('c2', '2026-10-19T10:00:00Z', { reply_to: 'c1', reply_to_user: 'u2', reply_to_name: ' Борис ' })))
      .toMatchObject({ reply_to: 'c1', reply_to_user: 'u2', reply_to_name: 'Борис' })
    expect(canReplyComment({ user_id: 'x' }, 'me')).toBe(true)
    expect(canReplyComment({ user_id: 'me' }, 'me')).toBe(true) // себе — тоже (fb_4cbd8655)
    expect(canReplyComment({ user_id: 'x' }, null)).toBe(false)

    const orig = { id: 'c1', name: 'Борис', body: `очень   длинный\n${'а'.repeat(80)}` }
    const reply = { id: 'c2', reply_to: 'c1', reply_to_user: 'u2', reply_to_name: 'Боря (старое)' }
    const q = replyQuote(reply, [orig, reply])
    expect(q.name).toBe('Борис')
    expect(q.text.startsWith('очень длинный а')).toBe(true)
    expect(q.text.endsWith('…')).toBe(true)
    expect(q.text.length).toBe(60)
    // исходный удален — только имя; адресат скрыт или не ответ — без цитаты
    expect(replyQuote({ ...reply, reply_to: null }, [])).toEqual({ name: 'Боря (старое)', text: null })
    expect(replyQuote({ ...reply, reply_to: null, reply_to_name: null }, [])).toBeNull()
    expect(replyQuote({ id: 'c3' }, [orig])).toBeNull()
  })

  it('серии: подряд от одного автора до 5 минут — один блок; другой автор, пауза или ответ — новая серия', () => {
    const at = (min) => new Date(Date.UTC(2026, 9, 20, 10, min)).toISOString()
    const c = (id, user_id, min, extra = {}) => ({ id, user_id, name: user_id, created_at: at(min), ...extra })
    const list = [c('a', 'x', 0), c('b', 'x', 4), c('d', 'x', 20), c('e', 'y', 21), c('f', 'y', 22, { reply_to_user: 'x' }), c('g', 'me', 23)]
    expect(commentSeries(list)).toEqual([
      { first: true, last: false }, { first: false, last: true },
      { first: true, last: true },
      { first: true, last: true }, { first: true, last: true },
      { first: true, last: true },
    ])
    expect(commentSeries([])).toEqual([])
    expect(commentSeries(null)).toEqual([])
  })

  it('цвет имени: у человека всегда один, в пределах палитры', () => {
    expect(nameTone('u1')).toBe(nameTone('u1'))
    for (const k of ['a', 'b', 'u1', 'длинный-id', '', null]) {
      expect(nameTone(k)).toBeGreaterThanOrEqual(1)
      expect(nameTone(k)).toBeLessThanOrEqual(NAME_TONES)
    }
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(nameTone)).size).toBeGreaterThan(2)
  })

  it('время по часам и плашки дней: «Сегодня/Вчера/17 октября», первая сегодняшняя — без плашки', () => {
    const now = new Date(2026, 9, 20, 15, 0).getTime()
    const at = (d, h, m) => new Date(2026, 9, d, h, m).toISOString()
    expect(commentClock(at(20, 9, 5))).toBe('09:05')
    expect(commentClock('нет')).toBe('')
    expect(commentDayLabel(at(20, 1, 0), now)).toBe('Сегодня')
    expect(commentDayLabel(at(19, 23, 59), now)).toBe('Вчера')
    expect(commentDayLabel(at(17, 12, 0), now)).toBe('17 октября')
    expect(commentDayLabel(new Date(2025, 0, 3).toISOString(), now)).toBe('3 января 2025')
    const c = (id, iso, extra = {}) => ({ id, created_at: iso, ...extra })
    expect(commentDayBreaks([c('a', at(20, 9, 0)), c('b', at(20, 10, 0))], now)).toEqual([null, null])
    expect(commentDayBreaks([c('a', at(18, 9, 0)), c('b', at(18, 10, 0)), c('d', at(20, 8, 0)), c('p', null, { pending: true })], now))
      .toEqual(['18 октября', null, 'Сегодня', null])
  })

  it('серия рвется на смене дня, даже если пауза короче 5 минут', () => {
    const list = [
      { id: 'a', user_id: 'x', created_at: new Date(2026, 9, 19, 23, 58).toISOString() },
      { id: 'b', user_id: 'x', created_at: new Date(2026, 9, 20, 0, 1).toISOString() },
    ]
    expect(commentSeries(list)).toEqual([{ first: true, last: true }, { first: true, last: true }])
  })

  it('двойной тап: тот же пузырь и не дольше порога', () => {
    expect(isDoubleTap(null, 'a', 100)).toBe(false)
    expect(isDoubleTap({ id: 'a', t: 100 }, 'a', 100 + DOUBLE_TAP_MS)).toBe(true)
    expect(isDoubleTap({ id: 'a', t: 100 }, 'a', 101 + DOUBLE_TAP_MS)).toBe(false)
    expect(isDoubleTap({ id: 'a', t: 100 }, 'b', 150)).toBe(false)
    expect(isDoubleTap({ id: 'a', t: 200 }, 'a', 100)).toBe(false)
  })
})

// Виды реакций — одним списком на клиенте и в SQL (check comment_likes.kind и проверка в comment_react).
// supabase/ живет в приватном репо: в публичном CI файла нет, тест пропускается (как pinPolicy.test.js).
const REACTIONS_SQL = resolve(__dirname, '../../supabase/migrations/20261020160000_comment_reactions.sql')
describe.skipIf(!existsSync(REACTIONS_SQL))('COMMENT_REACTIONS ↔ comment_reactions.sql', () => {
  it('check таблицы и comment_react — те же виды, что на клиенте', () => {
    const src = readFileSync(REACTIONS_SQL, 'utf8')
    const lists = [...src.matchAll(/in \(('[a-z]+'(?:,\s*'[a-z]+')*)\)/g)].map((m) => m[1].match(/[a-z]+/g))
    expect(lists.length).toBeGreaterThanOrEqual(2)
    for (const kinds of lists) expect(kinds).toEqual(COMMENT_REACTIONS.map((r) => r.kind))
  })
})
