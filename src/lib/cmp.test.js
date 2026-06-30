import { describe, it, expect } from 'vitest'
import { cmpIsoAsc, cmpIsoDesc } from './cmp.js'

describe('cmpIsoAsc', () => {
  it('старые раньше', () => {
    expect(cmpIsoAsc('2026-01-01', '2026-01-02')).toBe(-1)
    expect(cmpIsoAsc('2026-01-02', '2026-01-01')).toBe(1)
    expect(cmpIsoAsc('2026-01-01', '2026-01-01')).toBe(0)
  })
  it('сортировка массива по возрастанию', () => {
    const arr = ['2026-03-01', '2026-01-01', '2026-02-01']
    expect([...arr].sort(cmpIsoAsc)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
  it('null/undefined трактуются как пустая строка (раньше любых дат)', () => {
    expect(cmpIsoAsc(null, '2026-01-01')).toBe(-1)
    expect(cmpIsoAsc(undefined, undefined)).toBe(0)
  })
})

describe('cmpIsoDesc', () => {
  it('свежие раньше', () => {
    expect(cmpIsoDesc('2026-01-01', '2026-01-02')).toBe(1)
    expect(cmpIsoDesc('2026-01-02', '2026-01-01')).toBe(-1)
    expect(cmpIsoDesc('2026-01-01', '2026-01-01')).toBe(0)
  })
  it('сортировка массива по убыванию', () => {
    const arr = ['2026-01-01', '2026-03-01', '2026-02-01']
    expect([...arr].sort(cmpIsoDesc)).toEqual(['2026-03-01', '2026-02-01', '2026-01-01'])
  })
})
