// «В сети» (v8.6.0): отметка устройства не чаще раза в 2 минуты и только под своей
// сессией; чужие отметки — общий снимок для всех экранов, один запрос на всех.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const hasSession = vi.fn()
vi.mock('./supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, hasSession: (...a) => hasSession(...a) }))
const { touchPresence, refreshPresence, getPresence, subscribePresence, resetPresence, TOUCH_EVERY_MS, FETCH_EVERY_MS } =
  await import('./presence.js')

beforeEach(() => {
  resetPresence()
  rpc.mockReset().mockResolvedValue({ data: null, error: null })
  hasSession.mockReset().mockResolvedValue(true)
  vi.stubGlobal('navigator', { onLine: true })
})

describe('touchPresence', () => {
  it('отмечается под своей сессией и не чаще раза в 2 минуты', async () => {
    await touchPresence('u1', 1_000_000)
    await touchPresence('u1', 1_000_000 + 30_000)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('touch_my_presence')
    await touchPresence('u1', 1_000_000 + TOUCH_EVERY_MS)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('офлайн, без сессии или без учетки — ничего; ошибки не наружу', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await touchPresence('u1')
    vi.stubGlobal('navigator', { onLine: true })
    hasSession.mockResolvedValue(false)
    await touchPresence('u1')
    await touchPresence(null)
    expect(rpc).not.toHaveBeenCalled()
    hasSession.mockRejectedValue(new Error('boom'))
    await expect(touchPresence('u1')).resolves.toBeUndefined()
    hasSession.mockResolvedValue(true)
    rpc.mockRejectedValue(new Error('net'))
    await expect(touchPresence('u1', 9_000_000)).resolves.toBeUndefined()
  })
})

describe('refreshPresence', () => {
  it('общий снимок: Map(user → отметка), подписчики узнают', async () => {
    rpc.mockResolvedValue({ data: [{ user_id: 'a', last_seen_at: 't1' }, { user_id: 'b', last_seen_at: 't2' }], error: null })
    const seen = vi.fn()
    const off = subscribePresence(seen)
    await refreshPresence('me', { now: 1 })
    expect(rpc).toHaveBeenCalledWith('presence_visible')
    expect(getPresence().get('a')).toBe('t1')
    expect(seen).toHaveBeenCalledTimes(1)
    off()
  })

  it('не чаще раза в минуту; параллельные вызовы — один запрос', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await Promise.all([refreshPresence('me', { now: 1 }), refreshPresence('me', { now: 1 })])
    expect(rpc).toHaveBeenCalledTimes(1)
    await refreshPresence('me', { now: 1 + 10_000 })
    expect(rpc).toHaveBeenCalledTimes(1)
    await refreshPresence('me', { now: 1 + FETCH_EVERY_MS })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('нет функции на сервере — снимок прежний, без ошибки', async () => {
    rpc.mockResolvedValue({ data: [{ user_id: 'a', last_seen_at: 't1' }], error: null })
    await refreshPresence('me', { now: 1 })
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    await refreshPresence('me', { force: true, now: 2 })
    expect(getPresence().get('a')).toBe('t1')
  })

  it('выход из учетки — снимок пуст', async () => {
    rpc.mockResolvedValue({ data: [{ user_id: 'a', last_seen_at: 't1' }], error: null })
    await refreshPresence('me', { now: 1 })
    resetPresence()
    expect(getPresence().size).toBe(0)
  })
})
