import { beforeEach, describe, expect, it, vi } from 'vitest'

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
