import { describe, it, expect } from 'vitest'
import { LOGIN_RE, RESERVED_LOGINS, normalizeLogin, loginProblem, loginStatusText } from './login.js'

describe('loginProblem — те же правила, что у сервера (users_login_format, login_check)', () => {
  it.each(['sega', 'masha.k', 'ivan_1990', 'a12', 'abcdefghijklmnopqrst', '  SeGa  '])('%s — годится', (v) => {
    expect(loginProblem(v)).toBe('')
  })
  it.each([
    ['', /Придумай/],
    ['сега', /латиницей/],
    ['1sega', /с латинской буквы/],
    ['_sega', /с латинской буквы/],
    ['se', /от 3/],
    ['a'.repeat(21), /до 20/],
    ['se ga', /только буквы/],
    ['se-ga', /только буквы/],
    ['admin', /занят/],
    ['Support', /занят/],
  ])('%j — %s', (v, re) => expect(loginProblem(v)).toMatch(re))
  it('нормализация — trim и нижний регистр', () => expect(normalizeLogin('  Masha.K ')).toBe('masha.k'))
  it('регулярка = check в SQL', () => expect(LOGIN_RE.source).toBe('^[a-z][a-z0-9_.]{2,19}$'))
})

describe('loginStatusText', () => {
  it('ok — без текста, остальное — понятно', () => {
    expect(loginStatusText('ok')).toBe('')
    expect(loginStatusText('taken')).toMatch(/занят/)
    expect(loginStatusText('login_taken')).toMatch(/занят/)
    expect(loginStatusText('reserved')).toMatch(/занят/)
    expect(loginStatusText('bad_login')).toMatch(/a–z/)
    expect(loginStatusText('limited')).toMatch(/подожди/)
    expect(loginStatusText('???')).toMatch(/еще раз/)
  })
  it('резерв не пустой и в нижнем регистре', () => {
    expect(RESERVED_LOGINS.length).toBeGreaterThan(10)
    for (const r of RESERVED_LOGINS) expect(r).toBe(r.toLowerCase())
  })
})
