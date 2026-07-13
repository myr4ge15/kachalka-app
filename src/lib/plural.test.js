import { describe, it, expect } from 'vitest'
import { plural, pluralize } from './plural.js'

const day = (n) => plural(n, 'день', 'дня', 'дней')

describe('plural', () => {
  it('one: 1, 21, 31, 101 (кроме 11)', () => {
    for (const n of [1, 21, 31, 101, 1001]) expect(day(n)).toBe('день')
  })
  it('few: 2–4, 22–24 (кроме 12–14)', () => {
    for (const n of [2, 3, 4, 22, 23, 24, 102]) expect(day(n)).toBe('дня')
  })
  it('many: 0, 5–20, 11–14, 25–30', () => {
    for (const n of [0, 5, 10, 11, 12, 13, 14, 15, 20, 25, 100, 111, 112]) expect(day(n)).toBe('дней')
  })
  it('устойчива к отрицательным (по модулю)', () => {
    expect(day(-1)).toBe('день')
    expect(day(-2)).toBe('дня')
    expect(day(-5)).toBe('дней')
  })
})

describe('pluralize', () => {
  it('число + просклонённое слово', () => {
    expect(pluralize(1, 'неделю', 'недели', 'недель')).toBe('1 неделю')
    expect(pluralize(3, 'неделю', 'недели', 'недель')).toBe('3 недели')
    expect(pluralize(7, 'неделю', 'недели', 'недель')).toBe('7 недель')
  })
})
