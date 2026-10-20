// @vitest-environment jsdom
// db/push.js — края (покрытие 20.10.2026): адрес подписки устройства для таймера отдыха,
// состояние Настроек без service worker / с ошибками браузера, неполная подписка, отказ
// subscribe, «уже спрашивали» без localStorage, ошибки RPC настроек типов, сверка без
// сети и с отказом сервера после новой подписки.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const hasSession = vi.fn()
vi.mock('./supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, hasSession: (...a) => hasSession(...a) }))
const ensureOwnSession = vi.fn()
vi.mock('../lib/auth.js', () => ({ ensureOwnSession: (...a) => ensureOwnSession(...a) }))

vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BKey')
const {
  deviceSubscriptionEndpoint, getPushState, enablePush, disablePush, releasePushOnLogout, reconcilePushOwner,
  wasPushAsked, markPushAsked, getPushPrefs, setPushPref, PushError,
} = await import('./push.js')

function fakeSub(endpoint = 'https://push.example/abc', json) {
  return {
    endpoint,
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => json ?? { endpoint, keys: { p256dh: 'P', auth: 'A' } },
  }
}

let online = true
function setup({ permission = 'granted', existing = null, created = fakeSub(), reg = 'ok', getSub } = {}) {
  const pushManager = {
    getSubscription: getSub ?? vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(created),
  }
  const getRegistration = reg === 'throw' ? vi.fn().mockRejectedValue(new Error('sw'))
    : vi.fn().mockResolvedValue(reg === 'none' ? undefined : reg === 'nopm' ? {} : { pushManager })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration } })
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  globalThis.Notification = { permission, requestPermission: vi.fn().mockResolvedValue(permission) }
  globalThis.PushManager ??= function PushManager() {}
  window.matchMedia = vi.fn(() => ({ matches: true })) // «на экране Домой» и десктоп-запрос
  return { pushManager, created }
}

beforeEach(() => {
  localStorage.clear()
  online = true
  rpc.mockReset().mockResolvedValue({ error: null, data: null })
  hasSession.mockReset().mockResolvedValue(true)
  ensureOwnSession.mockReset().mockResolvedValue()
})

describe('deviceSubscriptionEndpoint (таймер отдыха)', () => {
  it('своя подписка с разрешением — ее адрес', async () => {
    setup({ existing: fakeSub('https://push.example/me') })
    localStorage.setItem('gym_app_push_owner', 'u1')
    expect(await deviceSubscriptionEndpoint('u1')).toBe('https://push.example/me')
  })

  it('нет разрешения, чужая, выключена тумблером, без подписки, сбой браузера — null', async () => {
    setup({ permission: 'default', existing: fakeSub() })
    localStorage.setItem('gym_app_push_owner', 'u1')
    expect(await deviceSubscriptionEndpoint('u1')).toBeNull()
    setup({ existing: fakeSub() })
    expect(await deviceSubscriptionEndpoint('u2')).toBeNull() // владелец u1
    localStorage.setItem('gym_app_push_off_u1', '1')
    expect(await deviceSubscriptionEndpoint('u1')).toBeNull()
    localStorage.removeItem('gym_app_push_off_u1')
    setup({ existing: null })
    expect(await deviceSubscriptionEndpoint('u1')).toBeNull()
    setup({ getSub: vi.fn().mockRejectedValue(new Error('x')) })
    expect(await deviceSubscriptionEndpoint('u1')).toBeNull()
    globalThis.Notification = undefined // браузер без уведомлений
    expect(await deviceSubscriptionEndpoint('u1')).toBeNull()
  })
})

describe('getPushState — края', () => {
  it('нет регистрации service worker — «не поддерживается», выключено', async () => {
    setup({ reg: 'none' })
    expect(await getPushState('u1')).toMatchObject({ enabled: false })
    setup({ reg: 'throw' })
    expect(await getPushState('u1')).toMatchObject({ enabled: false })
  })

  it('регистрация без pushManager и сбой getSubscription — без подписки', async () => {
    setup({ reg: 'nopm' })
    expect((await getPushState('u1')).enabled).toBe(false)
    setup({ getSub: vi.fn().mockRejectedValue(new Error('x')) })
    expect((await getPushState('u1')).enabled).toBe(false)
  })

  it('своя подписка без владельца — владелец записывается, сервер подтверждает', async () => {
    setup({ existing: fakeSub() })
    expect((await getPushState('u1')).enabled).toBe(true)
    expect(localStorage.getItem('gym_app_push_owner')).toBe('u1')
    expect(rpc).toHaveBeenCalledWith('push_subscribe', expect.any(Object))
  })
})

describe('enablePush — края', () => {
  it('разрешение «не выбрано» и офлайн — понятные отказы', async () => {
    setup({ permission: 'default' })
    await expect(enablePush('u1')).rejects.toThrow('Разрешение не выдано.')
    setup()
    online = false
    await expect(enablePush('u1')).rejects.toThrow(/только онлайн/)
  })

  it('без pushManager — «не умеет»; subscribe бросил — «не дал подписаться»', async () => {
    setup({ reg: 'nopm' })
    await expect(enablePush('u1')).rejects.toThrow(/не умеет/)
    const { pushManager } = setup()
    pushManager.subscribe.mockRejectedValue(new Error('NotAllowed'))
    await expect(enablePush('u1')).rejects.toThrow(/не дал подписаться/)
  })

  it('неполная подписка и сбой сети на RPC — PushError, подписка снимается', async () => {
    const bad = fakeSub('https://push.example/x', { endpoint: 'https://push.example/x' })
    setup({ created: bad })
    await expect(enablePush('u1')).rejects.toThrow(/неполную подписку/)
    expect(bad.unsubscribe).toHaveBeenCalled()
    const { created } = setup()
    rpc.mockRejectedValue(new Error('net'))
    await expect(enablePush('u1')).rejects.toThrow('Нет сети — попробуй позже.')
    expect(created.unsubscribe).toHaveBeenCalled()
  })

  it('вход бросил не-PushError без текста — общий текст', async () => {
    setup()
    ensureOwnSession.mockRejectedValue({})
    await expect(enablePush('u1')).rejects.toThrow('Не удалось включить уведомления.')
  })
})

describe('выкл и выход — края', () => {
  it('без подписки — ничего не делаем; в фоне — не ждем', async () => {
    setup()
    await disablePush('u1')
    expect(rpc).not.toHaveBeenCalled()
    const sub = fakeSub()
    setup({ existing: sub })
    let release
    rpc.mockReturnValue(new Promise((r) => { release = r }))
    await disablePush('u1', { background: true })
    expect(localStorage.getItem('gym_app_push_off_u1')).toBe('1')
    release({ error: null })
  })

  it('выход: подписка чужой учетки и выключенная тумблером — сервер не трогаем; офлайн — тоже', async () => {
    setup({ existing: fakeSub() })
    localStorage.setItem('gym_app_push_owner', 'u2')
    await releasePushOnLogout('u1')
    localStorage.setItem('gym_app_push_owner', 'u1')
    localStorage.setItem('gym_app_push_off_u1', '1')
    await releasePushOnLogout('u1')
    localStorage.removeItem('gym_app_push_off_u1')
    online = false
    await releasePushOnLogout('u1')
    expect(rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('gym_app_push_wanted_u1')).toBe('1')
    online = true
    rpc.mockRejectedValue(new Error('net'))
    await expect(releasePushOnLogout('u1')).resolves.toBeUndefined()
  })
})

describe('reconcilePushOwner — края', () => {
  it('без учетки, без поддержки, без pushManager — тихо выходим', async () => {
    setup()
    await reconcilePushOwner(null)
    setup({ reg: 'nopm' })
    await reconcilePushOwner('u1')
    globalThis.Notification = undefined
    await reconcilePushOwner('u1')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('сбой getSubscription, офлайн, своя без разрешения — сервер не трогаем', async () => {
    setup({ getSub: vi.fn().mockRejectedValue(new Error('x')) })
    await reconcilePushOwner('u1')
    setup({ existing: fakeSub() })
    online = false
    await reconcilePushOwner('u1')
    online = true
    setup({ permission: 'default', existing: fakeSub() })
    await reconcilePushOwner('u1')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('хотел пуши, подписки нет — подписываем; сервер отказал — новую снимаем, не бросаем', async () => {
    const { pushManager, created } = setup()
    localStorage.setItem('gym_app_push_wanted_u1', '1')
    rpc.mockResolvedValue({ error: { message: 'no' } })
    await expect(reconcilePushOwner('u1')).resolves.toBeUndefined()
    expect(pushManager.subscribe).toHaveBeenCalled()
    expect(created.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem('gym_app_push_owner')).toBeNull()
  })
})

describe('«уже спрашивали» и настройки типов — края', () => {
  it('отметка на учетку; без localStorage — «спрашивали», запись не падает', () => {
    expect(wasPushAsked('u1')).toBe(false)
    markPushAsked('u1')
    expect(wasPushAsked('u1')).toBe(true)
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private') })
    expect(wasPushAsked('u2')).toBe(true)
    expect(() => markPushAsked('u2')).not.toThrow()
    get.mockRestore(); set.mockRestore()
  })

  it('getPushPrefs: сбой сети и ошибка RPC; пустой ответ — {}', async () => {
    setup()
    rpc.mockRejectedValueOnce(new Error('net'))
    await expect(getPushPrefs('u1')).rejects.toThrow(/когда появится сеть/)
    rpc.mockResolvedValueOnce({ error: { message: 'x' } })
    await expect(getPushPrefs('u1')).rejects.toThrow(/Не удалось загрузить/)
    rpc.mockResolvedValueOnce({ error: null, data: null })
    expect(await getPushPrefs('u1')).toEqual({})
  })

  it('setPushPref: сбой сети, ошибка RPC; пустой ответ — {}', async () => {
    setup()
    rpc.mockRejectedValueOnce(new Error('net'))
    await expect(setPushPref('u1', 'reaction', true)).rejects.toBeInstanceOf(PushError)
    rpc.mockResolvedValueOnce({ error: { message: 'x' } })
    await expect(setPushPref('u1', 'reaction', true)).rejects.toThrow(/Не удалось сохранить/)
    rpc.mockResolvedValueOnce({ error: null, data: null })
    expect(await setPushPref('u1', 'reaction', 1)).toEqual({})
    expect(rpc).toHaveBeenLastCalledWith('set_push_pref', { p_type: 'reaction', p_on: true })
  })
})
