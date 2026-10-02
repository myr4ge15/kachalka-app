// Гонка входа и выхода (РЕВЬЮ-КОДА-2026-10-02, п. 21): ответ auth-login, пришедший
// после logout, не должен поднимать сессию вышедшего, подменять PIN в памяти и
// стирать офлайн-кэш PIN другой учетки.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const setSession = vi.fn(async () => ({ error: null }))
const signOut = vi.fn(async () => ({ error: null }))
const meta = new Map()
vi.mock('../db/supabase.js', () => ({
  supabase: { auth: { setSession: (...a) => setSession(...a), signOut: (...a) => signOut(...a), getSession: async () => ({ data: { session: null } }) } },
  isSessionOf: () => true,
  hasSession: async () => false,
}))
vi.mock('../db/local.js', () => ({
  getLoginMeta: async (k) => meta.get(k),
  setLoginMeta: async (k, v) => { meta.set(k, v) },
}))
vi.mock('./hash.js', () => ({ verifyPin: async (pin, c) => c.pin_hash === 'hash-' + pin }))

const { login, logout, verifyPinOffline, refreshSessionSilently, canRefreshSilently, noteLoginFailure, getSessionPin } =
  await import('./auth.js')

function okResponse(userId) {
  return {
    ok: true, status: 200,
    json: async () => ({
      session: { access_token: 'at-' + userId, refresh_token: 'rt-' + userId },
      pin_hash: 'h', pin_salt: 's', user: { id: userId, name: userId, role: 'user' },
    }),
  }
}

let fetchMock
beforeEach(async () => {
  await logout()
  meta.clear()
  setSession.mockClear()
  signOut.mockClear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('auth: вход и выход', () => {
  it('ответ на вход A после выхода A не поднимает сессию и не трогает PIN и кэш учетки B', async () => {
    meta.set('pin_B', { pin_hash: 'hash-2222', pin_salt: 's', name: 'B', role: 'user' })
    let release
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = () => r(okResponse('A')) }))
    const pending = login('A', '1111')
    await logout()                      // A вышел, не дождавшись ответа
    expect(await verifyPinOffline('B', '2222')).toMatchObject({ id: 'B' }) // вошел B по кэшу
    release()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    pending.catch(noteLoginFailure)
    expect(setSession).not.toHaveBeenCalled()
    expect(getSessionPin()).toBe('2222')
    expect(meta.get('pin_B').pin_hash).toBe('hash-2222')
  })

  it('PIN в памяти привязан к учетке: чужой PIN на сервер не уходит', async () => {
    meta.set('pin_A', { pin_hash: 'hash-1111', pin_salt: 's', name: 'A', role: 'user' })
    await verifyPinOffline('A', '1111')
    expect(canRefreshSilently('A')).toBe(true)
    expect(canRefreshSilently('B')).toBe(false)
    expect(await refreshSessionSilently('B')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('сервер отверг PIN: кэш стирается у ТОЙ учетки, повторно этот PIN не шлем', async () => {
    meta.set('pin_A', { pin_hash: 'hash-1111', pin_salt: 's', name: 'A', role: 'user' })
    meta.set('pin_B', { pin_hash: 'hash-2222', pin_salt: 's', name: 'B', role: 'user' })
    await verifyPinOffline('A', '1111')
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'invalid_credentials' }) })
    expect(await refreshSessionSilently('A')).toBe(false)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(meta.get('pin_A').pin_hash).toBeNull()
    expect(meta.get('pin_B').pin_hash).toBe('hash-2222')
    expect(canRefreshSilently('A')).toBe(false)
    expect(await refreshSessionSilently('A')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('тихий перевыпуск ждет уже идущий вход, а не шлет второй запрос', async () => {
    let release
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = () => r(okResponse('A')) }))
    const first = login('A', '1111')
    const silent = refreshSessionSilently('A')
    release()
    await first
    expect(await silent).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
