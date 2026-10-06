import { describe, it, expect } from 'vitest'
import {
  inviteFromUrl, stripInvite, inviteUrl, validateRegistration,
  inviteDeadText, inviteErrorText, inviteListLabel, inviteCreatorLabel, inviteMessage,
} from './invite.js'

const TOKEN = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'
const BASE = 'https://myr4ge15.github.io/kachalka-app/'

describe('inviteFromUrl', () => {
  it('достает токен из фрагмента', () => {
    expect(inviteFromUrl(`${BASE}#invite=${TOKEN}`)).toBe(TOKEN)
  })
  it('нет фрагмента или чужой фрагмент — null', () => {
    expect(inviteFromUrl(BASE)).toBeNull()
    expect(inviteFromUrl(`${BASE}#foo=bar`)).toBeNull()
    expect(inviteFromUrl(`${BASE}?invite=${TOKEN}`)).toBeNull()
  })
  it('обрезанный или кривой токен — null', () => {
    expect(inviteFromUrl(`${BASE}#invite=${TOKEN.slice(0, 30)}`)).toBeNull()
    expect(inviteFromUrl(`${BASE}#invite=${TOKEN.slice(0, 42)}+`)).toBeNull()
    expect(inviteFromUrl('не адрес')).toBeNull()
  })
})

describe('stripInvite', () => {
  it('стирает фрагмент и сохраняет остальной адрес', () => {
    expect(stripInvite(`${BASE}?push=x#invite=${TOKEN}`)).toBe(`${BASE}?push=x`)
  })
  it('стирать нечего — null', () => {
    expect(stripInvite(BASE)).toBeNull()
    expect(stripInvite(`${BASE}#other`)).toBeNull()
  })
})

describe('inviteUrl', () => {
  it('собирает ссылку с base', () => {
    expect(inviteUrl(TOKEN, 'https://myr4ge15.github.io', '/kachalka-app/')).toBe(`${BASE}#invite=${TOKEN}`)
    expect(inviteUrl(TOKEN, 'http://localhost:5173', '/kachalka-app')).toBe(`http://localhost:5173/kachalka-app/#invite=${TOKEN}`)
  })
  it('круговой путь: собранную ссылку читает inviteFromUrl', () => {
    expect(inviteFromUrl(inviteUrl(TOKEN, 'https://x.io', '/'))).toBe(TOKEN)
  })
})

describe('validateRegistration', () => {
  const ok = { name: 'Маша', pin: '4826', pin2: '4826' }
  it('валидная форма', () => expect(validateRegistration(ok)).toBe(''))
  it('пустое и длинное имя', () => {
    expect(validateRegistration({ ...ok, name: '   ' })).toMatch(/как тебя зовут/)
    expect(validateRegistration({ ...ok, name: 'я'.repeat(41) })).toMatch(/40/)
  })
  it('PIN не 4 цифры и несовпадение', () => {
    expect(validateRegistration({ ...ok, pin: '123', pin2: '123' })).toMatch(/4 цифры/)
    expect(validateRegistration({ ...ok, pin2: '4821' })).toMatch(/не совпадают/)
  })
  it('слишком простой PIN — сразу подсказка, без похода в сеть', () => {
    expect(validateRegistration({ ...ok, pin: '1234', pin2: '1234' })).toMatch(/простой PIN/)
    expect(inviteErrorText('weak_pin')).toMatch(/простой PIN/)
  })
})

describe('тексты', () => {
  it('у каждого мертвого статуса свой текст', () => {
    const texts = ['used', 'expired', 'revoked', 'invalid'].map(inviteDeadText)
    expect(new Set(texts).size).toBe(4)
  })
  it('коды ошибок регистрации', () => {
    expect(inviteErrorText('name_taken')).toMatch(/занято/)
    expect(inviteErrorText('used')).toBe(inviteDeadText('used'))
    expect(inviteErrorText('registered_login_failed')).toMatch(/войди/)
    expect(inviteErrorText('что-то')).toMatch(/Не получилось/)
  })
  it('строка списка в админке', () => {
    const now = new Date('2026-10-02T12:00:00Z')
    expect(inviteListLabel({ status: 'ok', expires_at: '2026-10-09T12:00:00Z' }, now)).toBe('⏳ ждет · еще 7 дн.')
    expect(inviteListLabel({ status: 'used', used_by_name: 'Маша', used_at: '2026-10-03T10:00:00' })).toBe('✅ Маша · 03.10')
    expect(inviteListLabel({ status: 'used', used_by_name: null, used_at: '2026-10-03T10:00:00' })).toMatch(/удален/)
    expect(inviteListLabel({ status: 'revoked' })).toMatch(/отозвана/)
  })
  it('создатель ссылки в админке', () => {
    expect(inviteCreatorLabel({ created_by_name: 'Дима', created_at: '2026-10-02T10:00:00' })).toBe('Создал: Дима · 02.10')
    expect(inviteCreatorLabel({ created_by_name: null, created_at: '2026-10-02T10:00:00' })).toMatch(/удаленный/)
    expect(inviteCreatorLabel({ created_by_name: 'Дима' })).toBe('Создал: Дима')
  })
})

describe('inviteMessage', () => {
  it('со ссылкой — текст, срок и ссылка последней строкой', () => {
    const url = `${BASE}#invite=${TOKEN}`
    const lines = inviteMessage({ url, expiresAt: new Date(2026, 9, 9, 15) }).split('\n')
    expect(lines[0]).toMatch(/журнал тренировок/)
    expect(lines).toContain('Ссылка одноразовая, работает до 09.10.')
    expect(lines.at(-1)).toBe(url)
  })
  it('без ссылки — только слова (для «Поделиться»)', () => {
    expect(inviteMessage({ expiresAt: new Date(2026, 9, 9) })).not.toMatch(/https?:/)
  })
  it('без срока или с мусором — общая фраза про 7 дней', () => {
    expect(inviteMessage({})).toMatch(/работает 7 дней\.$/)
    expect(inviteMessage({ expiresAt: 'nope' })).toMatch(/работает 7 дней\.$/)
  })
})
