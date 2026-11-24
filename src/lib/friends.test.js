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
  it('без имени, ссылки или кода остаются только доступные способы', () => {
    expect(friendMessage({ code: 'TEST-CODE' })).toBe('Зову тебя в друзья в kachalka-app 💪\n\nКод для раздела «Друзья»: TEST-CODE')
    expect(friendMessage({ url: 'https://x' })).toBe('Зову тебя в друзья в kachalka-app 💪\n\nhttps://x')
  })
  it('ссылка и текст для «Поделиться»', () => {
    expect(friendUrl('7f3q-9xwd', 'https://x.ru', '/kachalka-app')).toBe('https://x.ru/kachalka-app/#friend=7F3Q9XWD')
    const t = friendMessage({ name: 'Сега', code: '7F3Q-9XWD', url: 'https://x.ru/#friend=7F3Q9XWD' })
    expect(t.split('\n\n')).toEqual([
      'Сега зовет тебя в друзья в kachalka-app 💪',
      'https://x.ru/#friend=7F3Q9XWD',
      'Код для раздела «Друзья»: 7F3Q-9XWD',
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
  it.each([
    ['already', 'уже друзья'], ['self', 'собственный код'],
    ['limited', 'подожди час'], ['busy', 'попробуй завтра'],
  ])('принятие запасного кода объясняет статус %s', (status, hint) => {
    expect(codeStatusText(status)).toContain(hint)
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
