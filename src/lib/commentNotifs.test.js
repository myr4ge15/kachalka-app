// Комментарии в «Уведомлениях» (26.10.2026, fb_76d747a2): что из окна Ленты и из my_comment_reactions попадает в список.
import { describe, expect, it } from 'vitest'
import { commentNotifs, commentReactionNotifs } from './commentNotifs.js'

const ME = 'me'
const c = (over) => ({ id: 'c1', user_id: 'olya', name: 'Оля', body: 'мощно', created_at: '2026-10-26T10:00:00Z', ...over })

describe('commentNotifs', () => {
  it('чужой комментарий под моей тренировкой и ответ мне под чужой — да; свое и чужое чужим — нет', () => {
    const items = [
      { id: 'w1', user_id: ME, comments: [c(), c({ id: 'c2', user_id: ME }), c({ id: 'c3', created_at: null })] },
      { id: 'w2', user_id: 'petya', comments: [c({ id: 'c4', reply_to_user: ME }), c({ id: 'c5', reply_to_user: 'petya' })] },
    ]
    expect(commentNotifs(items, ME)).toEqual([
      { id: 'comment:c1', type: 'comment', mode: 'comment', workoutId: 'w1', who: 'Оля', whoId: 'olya', text: 'мощно', at: '2026-10-26T10:00:00Z' },
      { id: 'comment:c4', type: 'comment', mode: 'reply', workoutId: 'w2', who: 'Оля', whoId: 'olya', text: 'мощно', at: '2026-10-26T10:00:00Z' },
    ])
  })
  it('ответ мне под моей тренировкой — «ответ», не «комментарий»; пусто и мусор — []', () => {
    expect(commentNotifs([{ id: 'w1', user_id: ME, comments: [c({ reply_to_user: ME })] }], ME)[0].mode).toBe('reply')
    expect(commentNotifs(null, ME)).toEqual([])
    expect(commentNotifs([{ id: 'w', user_id: ME }], null)).toEqual([])
  })
})

describe('commentReactionNotifs', () => {
  it('строка сервера → уведомление с эмодзи; неизвестный вид и неполные строки — мимо', () => {
    const rows = [
      { comment_id: 'c1', workout_id: 'w1', body: 'сотка', user_id: 'olya', author_name: 'Оля', kind: 'fire', created_at: '2026-10-26T10:00:00Z' },
      { comment_id: 'c1', workout_id: 'w1', body: 'сотка', user_id: 'x', author_name: ' ', kind: 'heart', created_at: '2026-10-26T09:00:00Z' },
      { comment_id: 'c2', user_id: 'olya', kind: 'boom', created_at: '2026-10-26T10:00:00Z' },
      { comment_id: 'c3', user_id: 'olya', kind: 'like' },
    ]
    expect(commentReactionNotifs(rows)).toEqual([
      { id: 'creact:c1:olya', type: 'comment_react', workoutId: 'w1', who: 'Оля', whoId: 'olya', emoji: '🔥', text: 'сотка', at: '2026-10-26T10:00:00Z' },
      { id: 'creact:c1:x', type: 'comment_react', workoutId: 'w1', who: 'Кто-то', whoId: 'x', emoji: '❤️', text: 'сотка', at: '2026-10-26T09:00:00Z' },
    ])
    expect(commentReactionNotifs(undefined)).toEqual([])
  })
})
