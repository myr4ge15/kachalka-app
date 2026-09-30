import { describe, it, expect, beforeEach, vi } from 'vitest'
import { splashDelay, SPLASH_MIN_MS, markAppReady, onAppReady, resetAppReady } from './splash.js'

describe('onAppReady / markAppReady', () => {
  beforeEach(() => resetAppReady())

  it('зовет подписчика по сигналу готовности, один раз', () => {
    const fn = vi.fn()
    onAppReady(fn)
    expect(fn).not.toHaveBeenCalled()
    markAppReady()
    markAppReady()
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('опоздавший подписчик получает сигнал сразу', () => {
    markAppReady()
    const fn = vi.fn()
    onAppReady(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('отписка до сигнала отменяет вызов', () => {
    const fn = vi.fn()
    const off = onAppReady(fn)
    off()
    markAppReady()
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('splashDelay', () => {
  it('добирает остаток до минимального времени показа', () => {
    expect(splashDelay(400)).toBe(SPLASH_MIN_MS - 400)
  })
  it('не ждет, если приложение грузилось дольше минимума', () => {
    expect(splashDelay(SPLASH_MIN_MS + 500)).toBe(0)
  })
  it('при «уменьшить движение» убирает сплэш сразу', () => {
    expect(splashDelay(0, true)).toBe(0)
  })
  it('битое время считает нулем', () => {
    expect(splashDelay(NaN)).toBe(SPLASH_MIN_MS)
  })
  it('поддерживает свой минимум', () => {
    expect(splashDelay(100, false, 300)).toBe(200)
  })
})
