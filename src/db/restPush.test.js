import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession, supabase } from './supabase.js'
import { deviceSubscriptionEndpoint } from './push.js'

const calls = []
let endpointDelay = 0
vi.mock('./supabase.js', () => ({
  hasSession: vi.fn(async () => true),
  supabase: { rpc: vi.fn(async (name) => { calls.push(name); return { data: true, error: null } }) },
}))
vi.mock('./push.js', () => ({
  deviceSubscriptionEndpoint: vi.fn(() => new Promise((r) => setTimeout(() => r('https://fcm.googleapis.com/x'), endpointDelay))),
}))

const { scheduleRestPush, cancelRestPush } = await import('./restPush.js')
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('пуш таймера отдыха: порядок запросов (аудит 16.10)', () => {
  beforeEach(() => { calls.length = 0; endpointDelay = 0 })

  it('«Стоп» сразу после старта уходит ПОСЛЕ постановки, даже если постановка медленнее', async () => {
    endpointDelay = 30 // постановке еще нужно найти подписку устройства
    const set = scheduleRestPush('u1', { inSec: 90, title: 't', body: 'b' })
    const clear = cancelRestPush('u1')
    expect(await set).toBe(true)
    expect(await clear).toBe(true)
    expect(calls).toEqual(['rest_push_set', 'rest_push_clear'])
  })

  it('частые ±15 с — запросы в порядке вызова, последний побеждает', async () => {
    endpointDelay = 5
    await Promise.all([
      scheduleRestPush('u1', { inSec: 90, title: 't', body: 'b' }),
      scheduleRestPush('u1', { inSec: 105, title: 't', body: 'b' }),
      cancelRestPush('u1'),
      scheduleRestPush('u1', { inSec: 60, title: 't', body: 'b' }),
    ])
    expect(calls).toEqual(['rest_push_set', 'rest_push_set', 'rest_push_clear', 'rest_push_set'])
  })
})

describe('пуш таймера отдыха: сессия, подписка и ошибки', () => {
  it.each([false, true])('без готовой сессии не отправляет RPC (сеть: %s)', async (onLine) => {
    vi.stubGlobal('navigator', { onLine })
    vi.mocked(hasSession).mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    try {
      expect(await scheduleRestPush('u1', { inSec: 90 })).toBe(false)
      expect(await cancelRestPush('u1')).toBe(false)
      if (onLine) expect(hasSession).toHaveBeenCalledWith('u1')
      else expect(hasSession).not.toHaveBeenCalled()
      expect(deviceSubscriptionEndpoint).not.toHaveBeenCalled()
      expect(supabase.rpc).not.toHaveBeenCalled()
    } finally {
      vi.mocked(hasSession).mockReset().mockResolvedValue(true)
    }
  })

  it('без подписки RPC постановки не вызывается', async () => {
    vi.mocked(deviceSubscriptionEndpoint).mockResolvedValueOnce(null)
    expect(await scheduleRestPush('u1', { inSec: 90 })).toBe(false)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it.each([[undefined, 1], [-2, 1], ['12.7', 13], [960, 900]])('нормализует %j до %i секунд', async (inSec, sec) => {
    expect(await scheduleRestPush('u1', { inSec, title: 'Отдых', body: 'Готово' })).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('rest_push_set', {
      p_endpoint: 'https://fcm.googleapis.com/x', p_in_sec: sec, p_title: 'Отдых', p_body: 'Готово',
    })
  })

  it('успех постановки требует подтверждения сервера', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: false, error: null })
    expect(await scheduleRestPush('u1', { inSec: 90 })).toBe(false)
  })

  it.each([
    [() => Promise.resolve({ error: new Error('Сбой RPC') })],
    [() => Promise.reject(new Error('Нет сети'))],
  ])('сбой RPC не ломает таймер и очередь', async (fail) => {
    vi.mocked(supabase.rpc).mockImplementationOnce(fail).mockImplementationOnce(fail)
    expect(await scheduleRestPush('u1', { inSec: 90 })).toBe(false)
    expect(await cancelRestPush('u1')).toBe(false)
    expect(await cancelRestPush('u1')).toBe(true)
  })

  it('без navigator все равно проверяет сессию', async () => {
    vi.stubGlobal('navigator', undefined)
    expect(await cancelRestPush('u1')).toBe(true)
    expect(hasSession).toHaveBeenCalledExactlyOnceWith('u1')
  })
})
