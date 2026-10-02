// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const hasSession = vi.fn()
vi.mock('./supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, hasSession: (...a) => hasSession(...a) }))
const ensureOwnSession = vi.fn()
vi.mock('../lib/auth.js', () => ({ ensureOwnSession: (...a) => ensureOwnSession(...a) }))

vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BKey')
const { enablePush, disablePush, releasePushOnLogout, PushError, getPushPrefs, setPushPref, reconcilePushOwner, getPushState } = await import('./push.js')

function fakeSub(endpoint = 'https://push.example/abc') {
  return {
    endpoint,
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }),
  }
}

function setup({ permission = 'granted', existing = null, created = fakeSub() } = {}) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(created),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue({ pushManager }) },
  })
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
  globalThis.Notification = { permission, requestPermission: vi.fn().mockResolvedValue(permission) }
  globalThis.PushManager ??= function PushManager() {}
  return { pushManager, created }
}

beforeEach(() => {
  localStorage.clear()
  rpc.mockReset()
  hasSession.mockReset().mockResolvedValue(true)
  ensureOwnSession.mockReset().mockResolvedValue()
})

describe('enablePush', () => {
  it('подписывает браузер и сохраняет подписку на сервере', async () => {
    const { pushManager } = setup()
    rpc.mockResolvedValue({ error: null })
    await enablePush('u1')
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    expect(ensureOwnSession).toHaveBeenCalledWith('u1')
    expect(rpc).toHaveBeenCalledWith('push_subscribe', expect.objectContaining({
      p_endpoint: 'https://push.example/abc', p_p256dh: 'P', p_auth: 'A',
    }))
  })

  it('сервер не принял — подписка в браузере снимается, ошибка понятная', async () => {
    const { created } = setup()
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    await expect(enablePush('u1')).rejects.toBeInstanceOf(PushError)
    expect(created.unsubscribe).toHaveBeenCalled()
  })

  it('нет своей сессии — тоже откат, текст от входа сохраняется', async () => {
    const { created } = setup()
    ensureOwnSession.mockRejectedValue(new Error('Выйди и зайди заново по PIN'))
    await expect(enablePush('u1')).rejects.toThrow(/PIN/)
    expect(created.unsubscribe).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('разрешение не дали — до подписки не доходим', async () => {
    const { pushManager } = setup({ permission: 'denied' })
    await expect(enablePush('u1')).rejects.toThrow(/запрещены/)
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })
})

describe('disablePush / releasePushOnLogout', () => {
  it('снимает подписку в браузере и на сервере', async () => {
    const sub = fakeSub()
    setup({ existing: sub })
    rpc.mockResolvedValue({ error: null })
    await disablePush('u1')
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('push_unsubscribe', { p_endpoint: sub.endpoint })
  })

  it('без своей сессии — только браузер, сервер дочистит сам', async () => {
    const sub = fakeSub()
    setup({ existing: sub })
    hasSession.mockResolvedValue(false)
    await disablePush('u1')
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('выход не падает, даже если сервер отвечает ошибкой', async () => {
    setup({ existing: fakeSub() })
    rpc.mockRejectedValue(new Error('offline'))
    await expect(releasePushOnLogout('u1')).resolves.toBeUndefined()
  })
})

describe('настройки типов (v6.7.0)', () => {
  it('читает и пишет через RPC', async () => {
    setup()
    rpc.mockResolvedValueOnce({ data: { reminder: false }, error: null })
    expect(await getPushPrefs('u1')).toEqual({ reminder: false })
    expect(rpc).toHaveBeenCalledWith('get_push_prefs')
    rpc.mockResolvedValueOnce({ data: { reminder: true }, error: null })
    expect(await setPushPref('u1', 'reminder', true)).toEqual({ reminder: true })
    expect(rpc).toHaveBeenLastCalledWith('set_push_pref', { p_type: 'reminder', p_on: true })
  })

  it('без своей сессии и офлайн — понятная ошибка, без запроса', async () => {
    setup()
    hasSession.mockResolvedValue(false)
    await expect(getPushPrefs('u1')).rejects.toBeInstanceOf(PushError)
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await expect(setPushPref('u1', 'record', false)).rejects.toThrow(/Нет сети/)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('общий телефон: чья подписка (РЕВЬЮ-КОДА-2026-10-02, п. 9)', () => {
  it('вход другой учетки снимает подписку прежней, на сервер ее не перепривязывает', async () => {
    const sub = fakeSub()
    setup({ existing: sub })
    rpc.mockResolvedValue({ error: null })
    await enablePush('A')
    rpc.mockClear()
    await reconcilePushOwner('B')
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('push_subscribe', expect.anything())
  })

  it('свою подписку при входе подтверждает на сервере', async () => {
    const sub = fakeSub()
    setup({ existing: sub })
    rpc.mockResolvedValue({ error: null })
    await enablePush('A')
    rpc.mockClear()
    await reconcilePushOwner('A')
    expect(sub.unsubscribe).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('push_subscribe', expect.anything())
  })

  it('выход снимает подписку, следующий вход той же учетки восстанавливает ее сам', async () => {
    const sub = fakeSub()
    const { pushManager } = setup({ existing: sub })
    rpc.mockResolvedValue({ error: null })
    await enablePush('A')
    await releasePushOnLogout('A')
    expect(sub.unsubscribe).toHaveBeenCalled()
    pushManager.getSubscription.mockResolvedValue(null)
    pushManager.subscribe.mockClear()
    await reconcilePushOwner('A')
    expect(pushManager.subscribe).toHaveBeenCalled()
  })

  it('выключил тумблером — при входе подписку не возвращаем', async () => {
    const sub = fakeSub()
    const { pushManager } = setup({ existing: sub })
    rpc.mockResolvedValue({ error: null })
    await enablePush('A')
    await disablePush('A', { background: true })
    pushManager.getSubscription.mockResolvedValue(null)
    pushManager.subscribe.mockClear()
    await reconcilePushOwner('A')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('чужая подписка в Настройках — «выключено», без молчаливой перепривязки', async () => {
    const sub = fakeSub()
    setup({ existing: sub })
    rpc.mockResolvedValue({ error: null })
    await enablePush('A')
    rpc.mockClear()
    const s = await getPushState('B')
    expect(s.enabled).toBe(false)
    expect(rpc).not.toHaveBeenCalledWith('push_subscribe', expect.anything())
  })
})
