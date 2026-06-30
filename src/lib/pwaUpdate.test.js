import { describe, it, expect } from 'vitest'
import { shouldReshowUpdate } from './pwaUpdate.js'

const TTL = 4 * 60 * 60 * 1000 // 4 часа

describe('shouldReshowUpdate', () => {
  it('нет ждущего SW → не показываем', () => {
    expect(shouldReshowUpdate({ hasWaiting: false, snoozedAt: 1000, now: 1000 + TTL, ttl: TTL })).toBe(false)
  })
  it('не откладывали (snoozedAt=0) → не навязываем', () => {
    expect(shouldReshowUpdate({ hasWaiting: true, snoozedAt: 0, now: 9e9, ttl: TTL })).toBe(false)
  })
  it('TTL ещё не вышел → ждём', () => {
    expect(shouldReshowUpdate({ hasWaiting: true, snoozedAt: 1000, now: 1000 + TTL - 1, ttl: TTL })).toBe(false)
  })
  it('TTL вышел и SW ждёт → показываем повторно', () => {
    expect(shouldReshowUpdate({ hasWaiting: true, snoozedAt: 1000, now: 1000 + TTL, ttl: TTL })).toBe(true)
  })
  it('сильно после TTL → показываем', () => {
    expect(shouldReshowUpdate({ hasWaiting: true, snoozedAt: 1000, now: 1000 + TTL * 5, ttl: TTL })).toBe(true)
  })
})
