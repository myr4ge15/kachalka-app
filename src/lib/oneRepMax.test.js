import { describe, it, expect } from 'vitest'
import { epley, setOneRepMax, bestOneRepMax } from './oneRepMax.js'

describe('epley', () => {
  it('1 повтор → сам вес', () => {
    expect(epley(100, 1)).toBe(100)
  })
  it('формула Эпли для >1 повтора', () => {
    // 100 * (1 + 5/30) = 116.666...
    expect(epley(100, 5)).toBeCloseTo(116.6667, 3)
  })
  it('краевой (DoD): без веса/без повторов → 0, а не 1ПМ', () => {
    expect(epley(0, 10)).toBe(0)
    expect(epley(100, 0)).toBe(0)
    expect(epley(0, 0)).toBe(0)
    expect(epley(100, -3)).toBe(0)
  })
})

describe('setOneRepMax', () => {
  it('округление до 0.5 кг', () => {
    // 100 * (1 + 5/30) = 116.6667 → 116.5
    expect(setOneRepMax(100, 5)).toBe(116.5)
    expect(setOneRepMax(80, 1)).toBe(80)
  })
})

describe('bestOneRepMax', () => {
  it('лучший 1ПМ среди подходов', () => {
    const sets = [{ weight: 100, reps: 1 }, { weight: 80, reps: 8 }]
    // 80*(1+8/30)=101.33 → 101.5 > 100
    expect(bestOneRepMax(sets)).toBe(101.5)
  })
  it('упражнение без веса (weight 0) → 0', () => {
    expect(bestOneRepMax([{ weight: 0, reps: 15 }])).toBe(0)
  })
  it('пусто/undefined → 0', () => {
    expect(bestOneRepMax([])).toBe(0)
    expect(bestOneRepMax(undefined)).toBe(0)
  })
})
