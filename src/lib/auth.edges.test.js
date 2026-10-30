// lib/auth.js — края входа (покрытие веток, 30.10.2026): когда открывается офлайн-кэш, а когда
// нет, таймауты, чужая сессия на общем телефоне, ответы сервера без тела. Экранную часть правила
// «кэш только при недоступном сервере» держит LoginScreen.test.jsx, здесь — то, на что он опирается:
// коды ошибок и судьба кэша хэша. hash.js настоящий (обертка-шпион), чтобы сверка шла по PBKDF2.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ session: null, owner: 'u1', metaFails: false }))
const setSession = vi.fn(async () => ({ error: null }))
const signOut = vi.fn(async () => ({ error: null }))
const getSession = vi.fn(async () => ({ data: { session: h.session } }))
const rpc = vi.fn()
const meta = new Map()

vi.mock('../db/supabase.js', () => ({
  supabase: {
    auth: {
      setSession: (...a) => setSession(...a),
      signOut: (...a) => signOut(...a),
      getSession: (...a) => getSession(...a),
    },
    rpc: (...a) => rpc(...a),
  },
  isSessionOf: (s, id) => Boolean(s) && h.owner === id,
  hasSession: async (id) => Boolean(h.session) && h.owner === id,
}))
vi.mock('../db/local.js', () => ({
  getLoginMeta: async (k) => { if (h.metaFails) throw new Error('idb'); return meta.get(k) },
  setLoginMeta: async (k, v) => { meta.set(k, v) },
  listLoginMeta: async (prefix) => [...meta].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
  deleteLoginMeta: async (k) => { meta.delete(k) },
}))
vi.mock('./hash.js', async (orig) => {
  const real = await orig()
  return { ...real, verifyPin: vi.fn(real.verifyPin) }
})

const auth = await import('./auth.js')
const { LoginError } = auth
const { verifyPin, pbkdf2Hex, sha256Hex } = await import('./hash.js')

const res = (status, body) => ({ ok: status < 300, status, json: async () => body })
// Ответ без JSON в теле (прокси, HTML-страница ошибки).
const noJson = (status) => ({ ok: status < 300, status, json: async () => { throw new SyntaxError('html') } })
const OK = {
  session: { access_token: 'a', refresh_token: 'r' }, pin_hash: 'new-hash', pin_salt: 's',
  user: { id: 'u1', name: 'Дима', role: 'member' },
}
const sent = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body)
const flush = () => new Promise((r) => setTimeout(r, 0))
// Запрос, который висит, пока его не отменят через AbortController.
const hanging = (_url, opts) => new Promise((_, rej) => {
  opts.signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
})

// Кладет PIN в память так же, как офлайн-вход (без сервера).
async function unlock(userId, pin) {
  const salt = '00112233445566778899aabbccddeeff'
  meta.set(`pin_${userId}`, { pin_hash: await pbkdf2Hex(pin, salt), pin_salt: salt, name: userId, role: 'member' })
  expect(await auth.verifyPinOffline(userId, pin)).toMatchObject({ id: userId })
}

let fetchMock
beforeEach(async () => {
  await auth.logout()
  auth.noteLoginFailure(null)
  meta.clear(); setSession.mockClear(); signOut.mockClear(); getSession.mockClear(); rpc.mockReset(); vi.mocked(verifyPin).mockClear()
  h.session = { access_token: 'tok' }; h.owner = 'u1'; h.metaFails = false
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('офлайн-кэш: обходится только недоступный сервер', () => {
  it('сервер отверг PIN: старый PIN кэшем больше не открывается, учетка в пикере остается', async () => {
    await unlock('u1', '4826')
    fetchMock.mockResolvedValue(res(401, { error: 'invalid_credentials' }))
    const err = await auth.login('u1', '4826').catch((e) => e)
    expect(err).toMatchObject({ code: 'invalid', message: 'Неверный PIN', userId: 'u1' })
    auth.noteLoginFailure(err) // так поступает экран входа
    await flush()
    expect(await auth.verifyPinOffline('u1', '4826')).toBeNull() // null = «нужна сеть», а не вход
    expect(meta.get('pin_u1')).toMatchObject({ pin_hash: null, pin_salt: null, name: 'u1' })
    expect(auth.canRefreshSilently('u1')).toBe(false)
  })

  it('лок сервера — свой код (экран не идет в кэш), кэш и PIN в памяти целы', async () => {
    await unlock('u1', '4826')
    const hash = meta.get('pin_u1').pin_hash
    fetchMock.mockResolvedValue(res(429, { error: 'locked', retry_after: 900 }))
    const err = await auth.login('u1', '4826').catch((e) => e)
    expect(err).toMatchObject({ code: 'locked', retryAfter: 900 })
    auth.noteLoginFailure(err)
    await flush()
    expect(meta.get('pin_u1').pin_hash).toBe(hash)
    expect(auth.canRefreshSilently('u1')).toBe(true)
  })

  it.each([
    ['500', () => res(500, { error: 'server_error' }), 'server'],
    ['502 без JSON', () => noJson(502), 'server'],
    ['200 без сессии', () => res(200, { error: 'bridge_failed' }), 'server'],
    ['400 при входе по id', () => res(400, { error: 'bad_request' }), 'server'],
  ])('%s — запасной путь: код server, кэш открывает верным PIN', async (_name, make, code) => {
    await unlock('u1', '4826')
    fetchMock.mockResolvedValue(make())
    await expect(auth.login('u1', '4826')).rejects.toMatchObject({ code })
    expect(await auth.verifyPinOffline('u1', '4826')).toMatchObject({ id: 'u1' })
    expect(await auth.verifyPinOffline('u1', '0000')).toBe(false)
  })

  it('отказ сервера без тела: 429 без паузы, 500 — общий текст', async () => {
    fetchMock.mockResolvedValueOnce(noJson(429))
    await expect(auth.login('u1', '4826')).rejects.toMatchObject({ code: 'locked', retryAfter: null })
    fetchMock.mockResolvedValueOnce(noJson(500))
    await expect(auth.login('u1', '4826')).rejects.toMatchObject({ code: 'server', message: 'Не удалось войти.' })
  })
})

describe('таймаут запроса входа', () => {
  it('экран входа ждет свои 8 с: запрос отменяется и дает network (дальше — кэш)', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(hanging)
    let done = null
    const p = auth.login('u1', '4826', { timeoutMs: 8000 }).catch((e) => { done = e })
    await vi.advanceTimersByTimeAsync(7999)
    expect(done).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(done).toMatchObject({ code: 'network', userId: 'u1' })
  })

  it('без своего срока — общий DB_TIMEOUT_MS (холодный старт сервера)', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(hanging)
    let done = null
    const p = auth.loginByName('Дима', '4826').catch((e) => { done = e })
    await vi.advanceTimersByTimeAsync(29999)
    expect(done).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(done).toMatchObject({ code: 'network' })
  })

  it('заголовки пришли, тело зависло — все равно network в срок', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) })
    let done = null
    auth.login('u1', '4826', { timeoutMs: 8000 }).catch((e) => { done = e })
    await vi.advanceTimersByTimeAsync(8001)
    expect(done).toMatchObject({ code: 'network' })
  })
})

describe('сверка PIN по кэшу — через lib/hash', () => {
  const SALT = 'aabbccddeeff00112233445566778899'

  it('PBKDF2: сверяет hash.verifyPin с хэшем и солью из кэша', async () => {
    const hash = await pbkdf2Hex('4826', SALT)
    meta.set('pin_u1', { pin_hash: hash, pin_salt: SALT, name: 'Дима', role: 'admin' })
    expect(await auth.verifyPinOffline('u1', '4826')).toEqual({ id: 'u1', name: 'Дима', role: 'admin' })
    expect(verifyPin).toHaveBeenCalledWith('4826', { pin_hash: hash, pin_salt: SALT })
  })

  it('хэш отличается одной цифрой, короче или в другом регистре — отказ без исключений', async () => {
    const hash = await pbkdf2Hex('4826', SALT)
    const lastFlipped = hash.slice(0, -1) + (hash.at(-1) === '0' ? '1' : '0')
    for (const bad of [lastFlipped, hash.slice(0, -2), hash.toUpperCase()]) {
      meta.set('pin_u1', { pin_hash: bad, pin_salt: SALT })
      expect(await auth.verifyPinOffline('u1', '4826')).toBe(false)
    }
    expect(auth.canRefreshSilently('u1')).toBe(false) // неверный PIN в память не кладем
  })

  it('старая запись без соли — SHA-256', async () => {
    meta.set('pin_u1', { pin_hash: await sha256Hex('4826'), name: 'Дима' })
    expect(await auth.verifyPinOffline('u1', '4826')).toMatchObject({ id: 'u1' })
    expect(await auth.verifyPinOffline('u1', '1111')).toBe(false)
  })
})

describe('вход: края', () => {
  it('ошибки входа по id и по имени различаются, 400 — только по имени «не подходят»', async () => {
    fetchMock.mockResolvedValueOnce(res(401, {}))
    await expect(auth.login('u1', '4826')).rejects.toMatchObject({ message: 'Неверный PIN' })
    fetchMock.mockResolvedValueOnce(res(400, {}))
    await expect(auth.loginByName(null, '4826')).rejects.toMatchObject({ code: 'invalid' })
    expect(sent(1)).toEqual({ name: '', pin: '4826' })
  })

  it('кэш без соли записывается как null, а имя и роль — с сервера', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ...OK, pin_salt: undefined }))
    await auth.login('u1', '4826')
    expect(meta.get('pin_u1')).toEqual({ pin_hash: 'new-hash', pin_salt: null, name: 'Дима', role: 'member' })
  })

  it('вышли, пока поднималась сессия: PIN в память не кладем', async () => {
    fetchMock.mockResolvedValueOnce(res(200, OK))
    setSession.mockImplementationOnce(async () => { await auth.logout(); return { error: null } })
    await expect(auth.login('u1', '4826')).rejects.toMatchObject({ code: 'cancelled' })
    expect(auth.getSessionPin()).toBeNull()
  })

  it.each([
    ['по имени', () => auth.loginByName('Дима', '4826')],
    ['по приглашению', () => auth.registerByInvite('T', { name: 'Дима', pin: '4826' })],
    ['по ссылке сброса', () => auth.applyPinReset('T', '4826')],
    ['по коду восстановления', () => auth.resetPinByCode('dima', 'C', '4826')],
  ])('ответ после выхода не применяется: %s', async (_name, call) => {
    fetchMock.mockImplementationOnce(async () => { await auth.logout(); return res(200, OK) })
    await expect(call()).rejects.toMatchObject({ code: 'cancelled' })
    expect(setSession).not.toHaveBeenCalled()
    expect(auth.getSessionPin()).toBeNull()
  })

  it('два входа подряд: завершение первого не забывает второй, перевыпуск ждет именно его', async () => {
    let finishFirst
    let finishSecond
    fetchMock.mockImplementationOnce(() => new Promise((r) => { finishFirst = r }))
    fetchMock.mockImplementationOnce(() => new Promise((r) => { finishSecond = r }))
    const first = auth.login('u1', '4826')
    const second = auth.login('u1', '4826')
    finishFirst(res(500, {}))
    await expect(first).rejects.toMatchObject({ code: 'server' })
    const silent = auth.refreshSessionSilently('u1')
    finishSecond(res(200, OK))
    await second
    expect(await silent).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('код круга: сбой проверки — ошибка, а не «код верный»', async () => {
    fetchMock.mockResolvedValueOnce(res(500, {}))
    await expect(auth.checkCircleCode('7F3Q9XWD')).rejects.toMatchObject({ code: 'server' })
  })

  it('регистрация: ответ не JSON или без кода — server', async () => {
    fetchMock.mockResolvedValueOnce(noJson(500))
    await expect(auth.registerByInvite('T', { name: 'В', pin: '4826' })).rejects.toMatchObject({ code: 'server' })
    fetchMock.mockResolvedValueOnce(res(200, { status: 'ok' })) // 200, но сессии нет
    await expect(auth.registerByInvite('T', { name: 'В', pin: '4826' })).rejects.toMatchObject({ code: 'server' })
    expect(setSession).not.toHaveBeenCalled()
  })

  it('проверка ссылки: нестандартное тело — ошибка, а не «ссылка жива»', async () => {
    fetchMock.mockResolvedValueOnce(noJson(200))
    await expect(auth.checkInvite('T')).rejects.toMatchObject({ code: 'server' })
    fetchMock.mockResolvedValueOnce(noJson(200))
    await expect(auth.checkPinReset('T')).rejects.toMatchObject({ code: 'server' })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(auth.checkPinReset('T')).rejects.toMatchObject({ code: 'network' })
  })
})

describe('«Забыл PIN»: края', () => {
  it('запрос ссылки: пустой логин и сбой сервера', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ok: true }))
    await auth.requestPinReset(null)
    expect(sent()).toEqual({ action: 'request', login: '' })
    fetchMock.mockResolvedValueOnce(res(500, {}))
    await expect(auth.requestPinReset('m')).rejects.toMatchObject({ code: 'server' })
    fetchMock.mockResolvedValueOnce(noJson(429))
    await expect(auth.requestPinReset('m')).rejects.toMatchObject({ code: 'locked', retryAfter: null })
  })

  it('новый PIN: лок, мертвая ссылка, код сервера, ответ без сессии — без входа', async () => {
    const cases = [
      [noJson(429), { code: 'locked', retryAfter: null }],
      [res(429, { retry_after: 60 }), { code: 'locked', retryAfter: 60 }],
      [res(401, {}), { code: 'invalid' }],
      [res(400, { error: 'weak_pin' }), { code: 'weak_pin' }],
      [res(200, {}), { code: 'server' }],
      [noJson(500), { code: 'server' }],
    ]
    for (const [answer, expected] of cases) {
      fetchMock.mockResolvedValueOnce(answer)
      await expect(auth.applyPinReset('T', '4826')).rejects.toMatchObject(expected)
    }
    expect(setSession).not.toHaveBeenCalled()
  })

  it('по коду: пустые поля уходят пустой строкой', async () => {
    fetchMock.mockResolvedValueOnce(res(401, {}))
    await expect(auth.resetPinByCode(null, undefined, '4826')).rejects.toMatchObject({ code: 'invalid' })
    expect(sent()).toEqual({ action: 'code', login: '', code: '', pin: '4826' })
  })

  it('имя бота: сбой не кэшируется; отдельный бот сброса узнается по dedicated', async () => {
    fetchMock.mockResolvedValueOnce(res(500, {}))
    await expect(auth.getBotInfo()).rejects.toMatchObject({ code: 'server' })
    fetchMock.mockResolvedValueOnce(res(200, { username: 'kachalka_pin_bot', dedicated: true }))
    expect(await auth.getBotInfo()).toEqual({ username: 'kachalka_pin_bot', dedicated: true })
    expect(await auth.getBotUsername()).toBe('kachalka_pin_bot')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('смена PIN: края', () => {
  it('сбой чтения сессии — как «нет сессии», запроса нет', async () => {
    getSession.mockRejectedValueOnce(new Error('storage'))
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'server', message: expect.stringMatching(/Сессия не найдена/) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('старый сервер без новой сессии: кэш обновлен, текущая сессия не трогается', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, pin_hash: 'h2', session: { access_token: 'only-access' } }))
    expect(await auth.setPin('u1', '4826', '5091')).toBe(true)
    expect(setSession).not.toHaveBeenCalled()
    expect(meta.get('pin_u1')).toEqual({ pin_hash: 'h2', pin_salt: null })
    expect(auth.getSessionPin()).toBe('5091')
  })

  it('ответ без подтверждения или без JSON — ошибка, кэш хэша не тронут', async () => {
    meta.set('pin_u1', { pin_hash: 'old', name: 'Дима' })
    fetchMock.mockResolvedValueOnce(res(200, { pin_hash: 'evil' }))
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'server', message: 'Не удалось сменить PIN.' })
    fetchMock.mockResolvedValueOnce(noJson(429))
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'locked', retryAfter: null })
    fetchMock.mockResolvedValueOnce(noJson(401))
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'server', message: expect.stringMatching(/Сессия истекла/) })
    expect(meta.get('pin_u1').pin_hash).toBe('old')
  })

  it('PIN сменен, новую сессию не поставить — старый PIN в памяти не остается', async () => {
    await unlock('u1', '4826')
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, pin_hash: 'h2', session: { access_token: 'a', refresh_token: 'r' } }))
    setSession.mockResolvedValueOnce({ error: { message: 'x' } })
    await expect(auth.setPin('u1', '4826', '5091')).rejects.toMatchObject({ code: 'session' })
    expect(auth.getSessionPin()).not.toBe('4826')
  })
})

describe('удаление аккаунта: края', () => {
  it('чужая сессия на общем телефоне — токен чужой учетки на сервер не уходит', async () => {
    h.owner = 'u2'
    await expect(auth.deleteMyAccount('u1', '4826')).rejects.toMatchObject({ code: 'server', message: expect.stringMatching(/Сессия не найдена/) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('сессия без токена и ответ без JSON — отказ', async () => {
    h.session = { user: {} }
    await expect(auth.deleteMyAccount('u1', '4826')).rejects.toMatchObject({ code: 'server' })
    expect(fetchMock).not.toHaveBeenCalled()
    h.session = { access_token: 'tok' }
    fetchMock.mockResolvedValueOnce(noJson(200))
    await expect(auth.deleteMyAccount('u1', '4826')).rejects.toMatchObject({ code: 'server', message: expect.stringMatching(/Не удалось удалить/) })
    fetchMock.mockResolvedValueOnce(noJson(429))
    await expect(auth.deleteMyAccount('u1', '4826')).rejects.toMatchObject({ code: 'locked', retryAfter: null })
  })
})

describe('чужая сессия и тихий перевыпуск', () => {
  it('чужая сессия, PIN в памяти: сначала перевыпуск своей, потом запрос', async () => {
    await unlock('u1', '4826')
    h.owner = 'u2'
    fetchMock.mockResolvedValueOnce(res(200, OK))
    setSession.mockImplementationOnce(async () => { h.owner = 'u1'; return { error: null } })
    rpc.mockResolvedValueOnce({ data: 'dima', error: null })
    expect(await auth.getMyLogin('u1')).toBe('dima')
    expect(sent()).toEqual({ user_id: 'u1', pin: '4826' })
  })

  it('перевыпуск прошел, а сессия все равно не наша — RPC не зовем', async () => {
    await unlock('u1', '4826')
    h.owner = 'u2'
    fetchMock.mockResolvedValueOnce(res(200, OK))
    await expect(auth.getMyLogin('u1')).rejects.toMatchObject({ code: 'session', message: expect.stringMatching(/Выйди и зайди заново/) })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('перевыпуск уперся в лок — причина в тексте, PIN и кэш не стираются', async () => {
    await unlock('u1', '4826')
    h.session = null
    fetchMock.mockResolvedValueOnce(res(429, { retry_after: 60 }))
    await expect(auth.setSex('u1', 'm')).rejects.toMatchObject({ code: 'session', message: expect.stringMatching(/заблокировал/) })
    await flush()
    expect(auth.canRefreshSilently('u1')).toBe(true)
    expect(meta.get('pin_u1').pin_hash).toBeTruthy()
  })

  it('dropForeignSession: сессии нет, сбой чтения, зависший выход — без ошибок', async () => {
    h.session = null
    h.owner = 'u2'
    await auth.dropForeignSession('u1')
    expect(signOut).not.toHaveBeenCalled()
    getSession.mockRejectedValueOnce(new Error('storage'))
    await expect(auth.dropForeignSession('u1')).resolves.toBeUndefined()

    h.session = { access_token: 'чужой' }
    vi.useFakeTimers()
    signOut.mockImplementationOnce(() => new Promise(() => {}))
    let done = false
    const p = auth.dropForeignSession('u1').then(() => { done = true })
    await vi.advanceTimersByTimeAsync(2999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(done).toBe(true)
  })

  it('выход: PIN гаснет сразу, зависший signOut не держит дольше 3 с', async () => {
    await unlock('u1', '4826')
    vi.useFakeTimers()
    signOut.mockImplementationOnce(() => new Promise(() => {}))
    let done = false
    const p = auth.logout().then(() => { done = true })
    expect(auth.getSessionPin()).toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(done).toBe(true)
  })

  it('выход без сети: ошибка signOut наружу не выходит', async () => {
    signOut.mockRejectedValueOnce(new TypeError('offline'))
    await expect(auth.logout()).resolves.toBeUndefined()
  })
})

describe('noteLoginFailure', () => {
  const reason = () => auth.setName('u1', 'Дима').catch((e) => e.message)
  beforeEach(() => { h.session = null })

  it('вход, отмененный выходом, не подменяет настоящую причину', async () => {
    auth.noteLoginFailure(new LoginError('network', 'x'))
    auth.noteLoginFailure(new LoginError('cancelled', 'Вход отменен.'))
    expect(await reason()).toMatch(/Не достучаться/)
  })

  it('чужая ошибка (не LoginError) и пустая причина — общий текст', async () => {
    auth.noteLoginFailure(new Error('что-то'))
    expect(await reason()).toMatch(/Выйди и зайди заново/)
    auth.noteLoginFailure(undefined)
    expect(await reason()).toMatch(/Выйди и зайди заново/)
  })

  it('успешный вход снимает старую причину', async () => {
    auth.noteLoginFailure(new LoginError('network', 'x'))
    fetchMock.mockResolvedValue(res(200, OK)) // и вход, и тихий перевыпуск внутри reason()
    await auth.login('u1', '4826')
    expect(await reason()).toMatch(/Выйди и зайди заново/)
  })

  it('«неверный PIN» учетки A не гасит PIN учетки B в памяти и ее кэш', async () => {
    await unlock('A', '1111')
    await unlock('B', '2222')
    const err = Object.assign(new LoginError('invalid', 'x'), { userId: 'A' })
    auth.noteLoginFailure(err)
    await flush()
    expect(meta.get('pin_A').pin_hash).toBeNull()
    expect(meta.get('pin_B').pin_hash).toBeTruthy()
    expect(auth.canRefreshSilently('B')).toBe(true)
  })

  it('ошибка без владельца относится к последнему входу', async () => {
    await unlock('u1', '4826')
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await auth.login('u1', '4826').catch(() => {})
    auth.noteLoginFailure(new LoginError('invalid', 'x'))
    await flush()
    expect(meta.get('pin_u1').pin_hash).toBeNull()
  })

  it('кэша нет — не создаем пустую запись; сбой базы не роняет приложение', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await auth.login('u1', '4826').catch(() => {})
    auth.noteLoginFailure(new LoginError('invalid', 'x'))
    await flush()
    expect(meta.has('pin_u1')).toBe(false)
    h.metaFails = true
    auth.noteLoginFailure(new LoginError('invalid', 'x'))
    await flush() // необработанный reject уронил бы прогон
  })
})

describe('свои RPC: разбор ответов', () => {
  it('статус восстановления: объект вместо массива, пустой ответ, чужой тип бота', async () => {
    rpc.mockResolvedValueOnce({ data: { has_code: true, tg_linked: true, tg_bot: 'pin' }, error: null })
    expect(await auth.getRecoveryStatus('u1')).toEqual({ hasCode: true, codeCreatedAt: null, tgLinked: true, tgLinkedAt: null, tgBot: 'pin' })
    rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await auth.getRecoveryStatus('u1')).toEqual({ hasCode: false, codeCreatedAt: null, tgLinked: false, tgLinkedAt: null, tgBot: null })
    rpc.mockResolvedValueOnce({ data: [{ tg_bot: 42 }], error: null })
    expect((await auth.getRecoveryStatus('u1')).tgBot).toBeNull()
  })

  it('ошибка без текста — запасной текст; код 42501 — в подсказке; not authenticated — перевойти', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: {} })
    await expect(auth.unlinkTg('u1')).rejects.toMatchObject({ code: 'server', message: 'Не получилось — попробуй позже.' })
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(auth.getMyLogin('u1')).rejects.toMatchObject({ code: 'server', message: expect.stringMatching(/my_login.*42501/) })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Not Authenticated' } })
    await expect(auth.setSex('u1', 'f')).rejects.toMatchObject({ code: 'session' })
    rpc.mockResolvedValueOnce({ data: null, error: {} })
    await expect(auth.setName('u1', 'Дима')).rejects.toMatchObject({ message: 'Не удалось сменить имя.' })
  })

  it('setName: граница 30 символов, пустое значение, кэша еще нет', async () => {
    await expect(auth.setName('u1', null)).rejects.toMatchObject({ code: 'invalid' })
    rpc.mockResolvedValue({ data: null, error: null })
    const name = 'я'.repeat(30)
    expect(await auth.setName('u1', name)).toBe(name)
    expect(meta.get('pin_u1')).toEqual({ name })
  })

  it('setMyLogin: сервер не ответил статусом — server', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(auth.setMyLogin('u1', 'sega')).rejects.toMatchObject({ code: 'server' })
  })

  it('setSex офлайн — ошибка сети без запросов', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(auth.setSex('u1', 'f')).rejects.toMatchObject({ code: 'network', message: expect.stringMatching(/только онлайн/) })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('setSex: обрыв запроса — network, значение не считается сохраненным', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(auth.setSex('u1', 'f')).rejects.toMatchObject({ code: 'network' })
  })
})

describe('учетки устройства', () => {
  it('имя ростера важнее кэша, но пустое добирается из кэша; нет имени — пустая строка', async () => {
    meta.set('pin_a', { pin_hash: 'x', name: 'Аня', role: 'admin' })
    meta.set('pin_b', { pin_hash: 'x' })
    meta.set('pin_c', null)
    meta.set('pin_d', { name: 'Дина' })
    expect(await auth.knownAccounts([{ id: 'a', name: null }, { id: 'b' }])).toEqual([
      { id: 'a', name: 'Аня', role: 'admin' },
      { id: 'b', name: '', role: null },
      { id: 'c', name: '', role: null },
      { id: 'd', name: 'Дина', role: null },
    ])
  })

  it('профиль из кэша без имени и роли — null в полях, а не undefined', async () => {
    meta.set('pin_a', { pin_hash: 'x' })
    expect(await auth.getCachedProfile('a')).toEqual({ id: 'a', name: null, role: null })
  })
})
