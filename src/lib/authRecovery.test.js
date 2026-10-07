// lib/auth.js — «Забыл PIN» и свое восстановление (П1, v6.18.0).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const setSession = vi.fn(async () => ({ error: null }))
const signOut = vi.fn(async () => ({ error: null }))
let session = { access_token: 'tok', user: { app_metadata: { app_user_id: 'u1' } } }
let sessionOwner = 'u1'
const rpc = vi.fn()
const meta = new Map()
vi.mock('../db/supabase.js', () => ({
  supabase: {
    auth: {
      setSession: (...a) => setSession(...a),
      signOut: (...a) => signOut(...a),
      getSession: async () => ({ data: { session } }),
    },
    rpc: (...a) => rpc(...a),
  },
  isSessionOf: (s, id) => Boolean(s) && sessionOwner === id,
  hasSession: async (id) => Boolean(session) && sessionOwner === id,
}))
vi.mock('../db/local.js', () => ({
  getLoginMeta: async (k) => meta.get(k),
  setLoginMeta: async (k, v) => { meta.set(k, v) },
  listLoginMeta: async () => [],
  deleteLoginMeta: async (k) => { meta.delete(k) },
}))
vi.mock('./hash.js', () => ({ verifyPin: async (pin, c) => c?.pin_hash === 'hash-' + pin }))

const auth = await import('./auth.js')
const { LoginError } = auth
const res = (status, body) => ({ ok: status < 300, status, json: async () => body })
let fetchMock

beforeEach(async () => {
  await auth.logout()
  meta.clear(); setSession.mockClear(); signOut.mockClear(); rpc.mockReset()
  session = { access_token: 'tok' }; sessionOwner = 'u1'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => vi.unstubAllGlobals())

const T = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'
const OK = {
  session: { access_token: 'a', refresh_token: 'r' }, pin_hash: 'hash-4826', pin_salt: 's',
  user: { id: 'u7', name: 'Маша', role: 'member' },
}
const sent = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body)

describe('«Забыл PIN» — Edge pin-reset', () => {
  it('ссылка в Telegram: один ответ на любой логин; 429 — locked с ожиданием', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ok: true }))
    expect(await auth.requestPinReset('  masha ')).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toMatch(/functions\/v1\/pin-reset$/)
    expect(sent()).toEqual({ action: 'request', login: 'masha' })
    fetchMock.mockResolvedValueOnce(res(429, { error: 'locked', retry_after: 600 }))
    await expect(auth.requestPinReset('masha')).rejects.toMatchObject({ code: 'locked', retryAfter: 600 })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(auth.requestPinReset('masha')).rejects.toMatchObject({ code: 'network' })
  })

  it('проверка ссылки', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { status: 'invalid' }))
    expect(await auth.checkPinReset(T)).toBe('invalid')
    expect(sent()).toEqual({ action: 'check', token: T })
  })

  it('новый PIN по ссылке → вход и офлайн-кэш; мертвая ссылка — expired', async () => {
    fetchMock.mockResolvedValueOnce(res(200, OK))
    expect(await auth.applyPinReset(T, '4826')).toEqual({ id: 'u7', name: 'Маша', role: 'member' })
    expect(sent()).toEqual({ action: 'apply', token: T, pin: '4826' })
    expect(setSession).toHaveBeenCalled()
    expect(meta.get('pin_u7')).toMatchObject({ pin_hash: 'hash-4826' })
    fetchMock.mockResolvedValueOnce(res(410, { error: 'invalid' }))
    await expect(auth.applyPinReset(T, '4826')).rejects.toMatchObject({ code: 'expired' })
    fetchMock.mockResolvedValueOnce(res(400, { error: 'weak_pin' }))
    await expect(auth.applyPinReset(T, '1234')).rejects.toMatchObject({ code: 'weak_pin' })
  })

  it('по коду: вход; неверный — invalid; лимит — locked', async () => {
    fetchMock.mockResolvedValueOnce(res(200, OK))
    expect(await auth.resetPinByCode(' masha ', ' abcd-efgh-jkmn-pqrs ', '4826')).toMatchObject({ id: 'u7' })
    expect(sent()).toEqual({ action: 'code', login: 'masha', code: 'abcd-efgh-jkmn-pqrs', pin: '4826' })
    fetchMock.mockResolvedValueOnce(res(401, { error: 'invalid' }))
    await expect(auth.resetPinByCode('masha', 'x', '4826')).rejects.toMatchObject({ code: 'invalid' })
    fetchMock.mockResolvedValueOnce(res(429, { error: 'locked', retry_after: 60 }))
    await expect(auth.resetPinByCode('masha', 'x', '4826')).rejects.toMatchObject({ code: 'locked' })
  })

  it('имя бота — из Edge, кэшируется', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { username: 'kachalka_bot' }))
    expect(await auth.getBotUsername()).toBe('kachalka_bot')
    expect(await auth.getBotUsername()).toBe('kachalka_bot')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('свое восстановление — RPC под своей сессией', () => {
  it('статус', async () => {
    rpc.mockResolvedValueOnce({ data: [{ has_code: true, code_created_at: '2026-10-07T10:00:00Z', tg_linked: false, tg_linked_at: null }], error: null })
    expect(await auth.getRecoveryStatus('u1')).toEqual({ hasCode: true, codeCreatedAt: '2026-10-07T10:00:00Z', tgLinked: false, tgLinkedAt: null })
    expect(rpc).toHaveBeenCalledWith('my_recovery_status')
  })
  it('новый код, токен привязки, отвязка', async () => {
    rpc.mockResolvedValueOnce({ data: 'ABCD-EFGH-JKMN-PQRS', error: null })
    expect(await auth.createRecoveryCode('u1')).toBe('ABCD-EFGH-JKMN-PQRS')
    rpc.mockResolvedValueOnce({ data: T, error: null })
    expect(await auth.createTgLinkToken('u1')).toBe(T)
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await auth.unlinkTg('u1')
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['create_my_recovery_code', 'create_my_tg_link_token', 'unlink_my_tg'])
  })
  it('лимит выпуска — limited; офлайн — без запроса', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } })
    await expect(auth.createRecoveryCode('u1')).rejects.toMatchObject({ code: 'limited' })
    vi.stubGlobal('navigator', { onLine: false })
    rpc.mockClear()
    await expect(auth.createRecoveryCode('u1')).rejects.toMatchObject({ code: 'network' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('удаление своего аккаунта (П7, Edge account-delete)', () => {
  it('офлайн — без запроса', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(auth.deleteMyAccount('u1', '4826')).rejects.toMatchObject({ code: 'network' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('успех: Bearer своей сессии, в теле только PIN', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ok: true }))
    expect(await auth.deleteMyAccount('u1', '4826')).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toMatch(/functions\/v1\/account-delete$/)
    expect(opts.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body)).toEqual({ pin: '4826' })
  })
  it.each([
    [401, { error: 'invalid_credentials' }, 'invalid'],
    [401, { error: 'invalid_session' }, 'server'],
    [429, { error: 'locked', retry_after: 900 }, 'locked'],
    [409, { error: 'admin_account' }, 'admin'],
    [500, {}, 'server'],
  ])('ответ %s %j → %s', async (status, body, code) => {
    fetchMock.mockResolvedValueOnce(res(status, body))
    await expect(auth.deleteMyAccount('u1', '4826')).rejects.toMatchObject({ code })
  })
})
