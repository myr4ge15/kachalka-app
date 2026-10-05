// Вход по имени и учетки устройства (v6.12.0): loginByName, knownAccounts, forgetAccount.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const setSession = vi.fn(async () => ({ error: null }))
const meta = new Map()
vi.mock('../db/supabase.js', () => ({
  supabase: { auth: { setSession: (...a) => setSession(...a), signOut: async () => ({ error: null }), getSession: async () => ({ data: { session: null } }) } },
  isSessionOf: () => true,
  hasSession: async () => false,
}))
vi.mock('../db/local.js', () => ({
  getLoginMeta: async (k) => meta.get(k),
  setLoginMeta: async (k, v) => { meta.set(k, v) },
  listLoginMeta: async (prefix) => [...meta].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
  deleteLoginMeta: async (k) => { meta.delete(k) },
}))
vi.mock('./hash.js', () => ({ verifyPin: async (pin, c) => c.pin_hash === 'hash-' + pin }))

const { loginByName, knownAccounts, forgetAccount, logout, getSessionPin, LoginError } = await import('./auth.js')

let fetchMock
beforeEach(async () => {
  await logout()
  meta.clear()
  setSession.mockClear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const res = (status, body) => ({ ok: status < 300, status, json: async () => body })

describe('loginByName', () => {
  it('шлет имя (без лишних пробелов) и поднимает сессию найденной учетки', async () => {
    fetchMock.mockResolvedValue(res(200, {
      session: { access_token: 'a', refresh_token: 'r' }, pin_hash: 'h', pin_salt: 's',
      user: { id: 'u7', name: 'Анечка (ничего не делала)', role: 'member' },
    }))
    const u = await loginByName('  анечка ', '1234')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'анечка', pin: '1234' })
    expect(u).toEqual({ id: 'u7', name: 'Анечка (ничего не делала)', role: 'member' })
    expect(meta.get('pin_u7')).toMatchObject({ pin_hash: 'h', name: 'Анечка (ничего не делала)' })
    expect(getSessionPin()).toBe('1234')
    expect(setSession).toHaveBeenCalled()
  })

  it('неизвестное имя и неверный PIN — одна ошибка «Имя или PIN не подходят»', async () => {
    fetchMock.mockResolvedValue(res(401, { error: 'invalid_credentials' }))
    await expect(loginByName('кто-то', '0000')).rejects.toMatchObject({ code: 'invalid', message: 'Имя или PIN не подходят' })
    fetchMock.mockResolvedValue(res(400, { error: 'bad_request' }))
    await expect(loginByName('x'.repeat(80), '0000')).rejects.toMatchObject({ code: 'invalid' })
    expect(setSession).not.toHaveBeenCalled()
  })

  it('блокировка и сеть', async () => {
    fetchMock.mockResolvedValue(res(429, { error: 'locked', retry_after: 900 }))
    await expect(loginByName('Дима', '0000')).rejects.toMatchObject({ code: 'locked', retryAfter: 900 })
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await expect(loginByName('Дима', '0000')).rejects.toBeInstanceOf(LoginError)
  })
})

describe('knownAccounts / forgetAccount', () => {
  it('только учетки с кэшем PIN; порядок ростера, остальные — по имени', async () => {
    meta.set('pin_b', { pin_hash: 'x', name: 'Борис', role: 'member' })
    meta.set('pin_a', { pin_hash: null, name: 'Аня', role: 'admin' }) // кэш стерт сервером — учетка все равно «своя»
    meta.set('pin_z', { pin_hash: 'x', name: 'Ян', role: 'member' })
    meta.set('sig_login_users', 'x')
    const roster = [{ id: 'z', name: 'Ян Новый', avatar_url: 'u' }, { id: 'q', name: 'Чужой' }]
    expect(await knownAccounts(roster)).toEqual([
      { id: 'z', name: 'Ян Новый', avatar_url: 'u', role: 'member' },
      { id: 'a', name: 'Аня', role: 'admin' },
      { id: 'b', name: 'Борис', role: 'member' },
    ])
    expect(await knownAccounts()).toHaveLength(3)
  })

  it('забыть — убирает только кэш этой учетки', async () => {
    meta.set('pin_a', { pin_hash: 'x', name: 'Аня' })
    meta.set('pin_b', { pin_hash: 'x', name: 'Борис' })
    await forgetAccount('a')
    await forgetAccount(null)
    expect([...meta.keys()]).toEqual(['pin_b'])
  })
})
