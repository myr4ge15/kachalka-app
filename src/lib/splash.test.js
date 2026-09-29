import { describe, it, expect } from 'vitest'
import { splashDelay, SPLASH_MIN_MS } from './splash.js'

describe('splashDelay', () => {
  it('добирает остаток до минимального времени показа', () => {
    expect(splashDelay(400)).toBe(SPLASH_MIN_MS - 400)
  })
  it('не ждёт, если приложение грузилось дольше минимума', () => {
    expect(splashDelay(SPLASH_MIN_MS + 500)).toBe(0)
  })
  it('при «уменьшить движение» убирает сплэш сразу', () => {
    expect(splashDelay(0, true)).toBe(0)
  })
  it('битое время считает нулём', () => {
    expect(splashDelay(NaN)).toBe(SPLASH_MIN_MS)
  })
  it('поддерживает свой минимум', () => {
    expect(splashDelay(100, false, 300)).toBe(200)
  })
})
