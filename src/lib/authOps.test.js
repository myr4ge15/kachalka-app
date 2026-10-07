// lib/auth.js — операции, которые раньше выполнялись только в заглушках экранов
// (v6.14.2, замер покрытия 06.10: 62%): смена PIN, смена имени, регистрация по
// приглашению, проверка ссылки, снятие чужой сессии, профиль из кэша, тихий
// перевыпуск сессии и отказ при ошибке входа.
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

describe('setPin', () => {
  it('без сессии — отказ без запроса', async () => {
    session = null
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'server' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('успех: обновляет офлайн-кэш хэша, ставит свежую сессию, запоминает новый PIN', async () => {
    meta.set('pin_u1', { pin_hash: 'old', name: 'Дима', role: 'member' })
    fetchMock.mockResolvedValue(res(200, { ok: true, pin_hash: 'hash-5091', pin_salt: 's2', session: { access_token: 'a2', refresh_token: 'r2' } }))
    expect(await auth.setPin('u1', '4826', '5091')).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toMatch(/auth-set-pin$/)
    expect(opts.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body)).toEqual({ user_id: 'u1', current_pin: '4826', new_pin: '5091' })
    expect(meta.get('pin_u1')).toEqual({ pin_hash: 'hash-5091', pin_salt: 's2', name: 'Дима', role: 'member' })
    expect(setSession).toHaveBeenCalledWith({ access_token: 'a2', refresh_token: 'r2' })
    expect(auth.getSessionPin()).toBe('5091')
  })

  it.each([
    [401, { error: 'invalid_credentials' }, 'invalid', 'Неверный текущий PIN'],
    [401, { error: 'invalid_session' }, 'server', 'Сессия истекла'],
    [403, {}, 'server', 'чужой PIN'],
    [429, { error: 'locked', retry_after: 900 }, 'locked', 'Слишком много попыток'],
    [400, { error: 'weak_pin' }, 'invalid', 'простой PIN'],
    [500, { error: 'boom' }, 'server', 'boom'],
  ])('ответ %s → %s', async (status, body, code, text) => {
    fetchMock.mockResolvedValue(res(status, body))
    const e = await auth.setPin('u1', '4826', '5091').catch((x) => x)
    expect(e).toBeInstanceOf(LoginError)
    expect(e.code).toBe(code)
    expect(e.message).toMatch(text)
  })

  it('PIN сменен, но новую сессию не поставить — честно просим войти заново', async () => {
    fetchMock.mockResolvedValue(res(200, { ok: true, pin_hash: 'h', session: { access_token: 'a', refresh_token: 'r' } }))
    setSession.mockResolvedValueOnce({ error: { message: 'x' } })
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'session' })
  })

  it('нет сети — network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'network' })
  })
})

describe('setName', () => {
  it('проверки до сети: длина и офлайн', async () => {
    await expect(auth.setName('u1', '  ')).rejects.toMatchObject({ code: 'invalid' })
    vi.stubGlobal('navigator', { onLine: false })
    await expect(auth.setName('u1', 'Дима')).rejects.toMatchObject({ code: 'network' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('успех: RPC под своей сессией, имя в офлайн-кэше', async () => {
    meta.set('pin_u1', { pin_hash: 'h', name: 'Старое' })
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await auth.setName('u1', '  Дмитрий ')).toBe('Дмитрий')
    expect(rpc).toHaveBeenCalledWith('set_my_name', { p_name: 'Дмитрий' })
    expect(meta.get('pin_u1')).toEqual({ pin_hash: 'h', name: 'Дмитрий' })
  })
  it('имя до 30 (П4); нет прав — подсказка админу; JWT — перевойти', async () => {
    await expect(auth.setName('u1', 'я'.repeat(31))).rejects.toThrow('от 1 до 30')
    rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'permission denied' } })
    await expect(auth.setName('u1', 'Маша')).rejects.toThrow('напиши админу')
    rpc.mockResolvedValueOnce({ error: { message: 'JWT expired' } })
    await expect(auth.setName('u1', 'Маша')).rejects.toMatchObject({ code: 'session' })
  })
  it('чужая сессия и нечем перевыпустить — отказ «нет сессии», RPC не зовется', async () => {
    sessionOwner = 'someone-else'
    await expect(auth.setName('u1', 'Дима')).rejects.toMatchObject({ code: 'session' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

// П4 (07.10.2026): свой логин для входа (my_login / set_my_login).
describe('логин', () => {
  it('getMyLogin: свой логин или null; офлайн — без запроса', async () => {
    rpc.mockResolvedValueOnce({ data: 'sega', error: null })
    expect(await auth.getMyLogin('u1')).toBe('sega')
    expect(rpc).toHaveBeenCalledWith('my_login')
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await auth.getMyLogin('u1')).toBe(null)
    vi.stubGlobal('navigator', { onLine: false })
    rpc.mockClear()
    await expect(auth.getMyLogin('u1')).rejects.toMatchObject({ code: 'network' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('setMyLogin: формат проверяется до сети, сохраняется в нижнем регистре', async () => {
    await expect(auth.setMyLogin('u1', 'сега')).rejects.toMatchObject({ code: 'bad' })
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValueOnce({ data: 'ok', error: null })
    expect(await auth.setMyLogin('u1', '  Sega ')).toBe('sega')
    expect(rpc).toHaveBeenCalledWith('set_my_login', { p_login: 'sega' })
  })
  it('setMyLogin: занят / лимит — код сервера и понятный текст', async () => {
    rpc.mockResolvedValueOnce({ data: 'taken', error: null })
    await expect(auth.setMyLogin('u1', 'masha')).rejects.toMatchObject({ code: 'taken', message: expect.stringMatching(/занят/) })
    rpc.mockResolvedValueOnce({ data: 'limited', error: null })
    await expect(auth.setMyLogin('u1', 'masha')).rejects.toMatchObject({ code: 'limited' })
  })
  it('проверка логина при регистрации — по ссылке', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { status: 'taken' }))
    expect(await auth.checkLoginForInvite('T', 'sega')).toBe('taken')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'check_login', token: 'T', login: 'sega' })
    fetchMock.mockResolvedValueOnce(res(500, {}))
    await expect(auth.checkLoginForInvite('T', 'sega')).rejects.toBeInstanceOf(LoginError)
  })
})

describe('приглашение', () => {
  it('проверка ссылки: статус из ответа; мусор — ошибка', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { status: 'expired' }))
    expect(await auth.checkInvite('T')).toBe('expired')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'check', token: 'T' })
    fetchMock.mockResolvedValueOnce(res(500, {}))
    await expect(auth.checkInvite('T')).rejects.toBeInstanceOf(LoginError)
  })

  it('регистрация: сессия + офлайн-кэш нового участника', async () => {
    fetchMock.mockResolvedValue(res(200, {
      session: { access_token: 'a', refresh_token: 'r' }, pin_hash: 'hash-4826', pin_salt: 's',
      user: { id: 'n1', name: 'Вася', role: 'member' },
    }))
    const u = await auth.registerByInvite('T', { name: 'Вася', pin: '4826', sex: 'm', login: 'vasya' })
    expect(u).toEqual({ id: 'n1', name: 'Вася', role: 'member' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'redeem', token: 'T', name: 'Вася', pin: '4826', sex: 'm', login: 'vasya' })
    expect(meta.get('pin_n1')).toMatchObject({ pin_hash: 'hash-4826', name: 'Вася' })
    expect(await auth.getCachedProfile('n1')).toEqual({ id: 'n1', name: 'Вася', role: 'member' })
  })

  it('отказ сервера — код ошибки как есть; учетка создана, но вход не удался — id для входа', async () => {
    fetchMock.mockResolvedValueOnce(res(409, { error: 'name_taken' }))
    await expect(auth.registerByInvite('T', { name: 'Вася', pin: '4826' })).rejects.toMatchObject({ code: 'name_taken' })
    fetchMock.mockResolvedValueOnce(res(502, { error: 'registered_login_failed', user: { id: 'n2', name: 'Петя' } }))
    await expect(auth.registerByInvite('T', { name: 'Петя', pin: '4826' })).rejects.toMatchObject({ code: 'registered_login_failed', userId: 'n2' })
  })
})

describe('сессия на общем телефоне', () => {
  it('dropForeignSession снимает только ЧУЖУЮ сессию и только локально', async () => {
    sessionOwner = 'u1'
    await auth.dropForeignSession('u1')
    expect(signOut).not.toHaveBeenCalled()
    sessionOwner = 'u2'
    await auth.dropForeignSession('u1')
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('getCachedProfile: нет кэша или id — null', async () => {
    expect(await auth.getCachedProfile(null)).toBeNull()
    expect(await auth.getCachedProfile('nobody')).toBeNull()
  })

  it('тихий перевыпуск: без PIN в памяти — false; неверный PIN — стирает кэш хэша', async () => {
    expect(await auth.refreshSessionSilently('u1')).toBe(false)
    meta.set('pin_u1', { pin_hash: 'hash-4826', name: 'Дима' })
    await auth.verifyPinOffline('u1', '4826') // PIN в памяти
    expect(auth.canRefreshSilently('u1')).toBe(true)
    fetchMock.mockResolvedValue(res(401, { error: 'invalid_credentials' }))
    expect(await auth.refreshSessionSilently('u1')).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(meta.get('pin_u1')).toMatchObject({ pin_hash: null, pin_salt: null })
    expect(auth.canRefreshSilently('u1')).toBe(false)
  })
})

describe('«Мой круг»: регистрация по коду', () => {
  it('превью кода и регистрация шлют code вместо token', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { status: 'ok', circle_name: 'Зал', inviter_name: 'Сега' }))
    expect(await auth.checkCircleCode('7F3Q9XWD')).toMatchObject({ status: 'ok', circle_name: 'Зал' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'circle_check', code: '7F3Q9XWD' })
    fetchMock.mockResolvedValueOnce(res(200, { status: 'ok' }))
    await auth.checkLoginForInvite({ code: '7F3Q9XWD' }, 'masha')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'check_login', code: '7F3Q9XWD', login: 'masha' })
    fetchMock.mockResolvedValueOnce(res(200, {
      session: { access_token: 'a', refresh_token: 'r' }, pin_hash: 'hash-4826', pin_salt: 's',
      user: { id: 'n2', name: 'Маша', role: 'member' }, circle: { status: 'active' },
    }))
    expect(await auth.registerByInvite({ code: '7F3Q9XWD' }, { name: 'Маша', pin: '4826', login: 'masha' })).toMatchObject({ id: 'n2' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ action: 'redeem', code: '7F3Q9XWD', login: 'masha' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).token).toBeUndefined()
  })
  it('отказы по коду — понятный текст', async () => {
    fetchMock.mockResolvedValueOnce(res(503, { error: 'busy' }))
    await expect(auth.registerByInvite({ code: '7F3Q9XWD' }, { name: 'М', pin: '4826' })).rejects.toMatchObject({ code: 'busy' })
  })
})
