import { describe, it, expect, vi } from 'vitest'
import { shouldReshowUpdate, makeReloadOnce, isRealUpdate } from './pwaUpdate.js'

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

describe('isRealUpdate', () => {
  it('версия на сервере та же → обновляться не на что', () => {
    expect(isRealUpdate('5.14.2', '5.14.2')).toBe(false)
  })
  it('версия на сервере другая → это обновление', () => {
    expect(isRealUpdate('5.14.2', '5.15.0')).toBe(true)
  })
  it('серверную версию узнать не удалось → показываем (fail open)', () => {
    expect(isRealUpdate('5.14.2', null)).toBe(true)
    expect(isRealUpdate('5.14.2', undefined)).toBe(true)
    expect(isRealUpdate('5.14.2', '')).toBe(true)
  })
  it('сравнение по значению, а не по типу', () => {
    expect(isRealUpdate(5, '5')).toBe(false)
  })
})

describe('makeReloadOnce', () => {
  it('первый вызов перезагружает', () => {
    const reload = vi.fn()
    makeReloadOnce(reload)()
    expect(reload).toHaveBeenCalledTimes(1)
  })
  it('повторные вызовы не дублируют reload', () => {
    const reload = vi.fn()
    const once = makeReloadOnce(reload)
    once(); once(); once()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
