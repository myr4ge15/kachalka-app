import { describe, it, expect } from 'vitest'
import { fmtAgo } from './dates.js'

describe('fmtAgo', () => {
  const now = 1_700_000_000_000
  const ago = (ms) => fmtAgo(now - ms, now)

  it('свежее (<45 c) → «только что»', () => {
    expect(ago(0)).toBe('только что')
    expect(ago(44_000)).toBe('только что')
  })
  it('минуты', () => {
    expect(ago(60_000)).toBe('1 мин назад')
    expect(ago(45_000)).toBe('1 мин назад')
    expect(ago(5 * 60_000)).toBe('5 мин назад')
    expect(ago(59 * 60_000)).toBe('59 мин назад')
  })
  it('часы', () => {
    expect(ago(60 * 60_000)).toBe('1 ч назад')
    expect(ago(5 * 60 * 60_000)).toBe('5 ч назад')
  })
  it('дни', () => {
    expect(ago(24 * 60 * 60_000)).toBe('1 дн назад')
    expect(ago(3 * 24 * 60 * 60_000)).toBe('3 дн назад')
  })
  it('пустой/невалидный/будущий → пусто', () => {
    expect(fmtAgo(null, now)).toBe('')
    expect(fmtAgo(undefined, now)).toBe('')
    expect(fmtAgo(0, now)).toBe('')
    expect(fmtAgo(now + 10_000, now)).toBe('только что')
  })
})
