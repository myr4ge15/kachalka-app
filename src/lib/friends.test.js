import { describe, expect, it } from 'vitest'
import {
  codeStatusText, friendFromUrl, friendMessage, friendUrl, groupFriends, pairState, requestStatusText, stripFriend,
} from './friends.js'

describe('friends: ссылка #friend=', () => {
  it('код из адреса нормализуется, мусор — null', () => {
    expect(friendFromUrl('https://x.ru/kachalka-app/#friend=7f3q-9xwd')).toBe('7F3Q9XWD')
    expect(friendFromUrl('https://x.ru/kachalka-app/#friend=nope')).toBeNull()
    expect(friendFromUrl('https://x.ru/kachalka-app/#join=7F3Q9XWD')).toBeNull()
    expect(friendFromUrl('кривой адрес')).toBeNull()
  })
  it('stripFriend стирает фрагмент только с friend', () => {
    expect(stripFriend('https://x.ru/app/#friend=7F3Q9XWD')).toBe('https://x.ru/app/')
    expect(stripFriend('https://x.ru/app/#join=7F3Q9XWD')).toBeNull()
  })
  it('ссылка и текст для «Поделиться»', () => {
    expect(friendUrl('7f3q-9xwd', 'https://x.ru', '/kachalka-app')).toBe('https://x.ru/kachalka-app/#friend=7F3Q9XWD')
    const t = friendMessage({ name: 'Сега', code: '7F3Q-9XWD', url: 'https://x.ru/#friend=7F3Q9XWD' })
    expect(t.split('\n')).toEqual([
      'Сега зовет тебя в друзья в журнале тренировок 💪',
      'Открой ссылку — или в приложении: Профиль → «Друзья» → «Ввести код».',
      'Код: 7F3Q-9XWD',
      'https://x.ru/#friend=7F3Q9XWD',
    ])
  })
})

describe('friends: списки и тексты', () => {
  const rows = [
    { user_id: 'a', state: 'friend' }, { user_id: 'b', state: 'incoming' },
    { user_id: 'c', state: 'outgoing' }, { user_id: 'd', state: 'blocked' }, { user_id: 'e', state: 'weird' },
  ]
  it('groupFriends раскладывает по состояниям, лишнее игнорирует', () => {
    const g = groupFriends(rows)
    expect([g.friend, g.incoming, g.outgoing, g.blocked].map((x) => x.map((r) => r.user_id))).toEqual([['a'], ['b'], ['c'], ['d']])
    expect(groupFriends(null).friend).toEqual([])
  })
  it('pairState — состояние пары или none', () => {
    expect(pairState(rows, 'b')).toBe('incoming')
    expect(pairState(rows, 'zzz')).toBe('none')
    expect(pairState(null, 'a')).toBe('none')
    expect(pairState({}, 'a')).toBe('none')
  })
  it('тексты статусов', () => {
    expect(codeStatusText('ok')).toMatch(/друзья/)
    expect(codeStatusText('invalid')).toMatch(/не подходит/)
    expect(codeStatusText('???')).toMatch(/позже/)
    expect(requestStatusText('sent')).toBe('Заявка отправлена')
    expect(requestStatusText('pending')).toBe('Заявка отправлена')
    expect(requestStatusText('accepted')).toMatch(/друзья/)
  })
})
