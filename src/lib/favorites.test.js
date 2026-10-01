import { describe, it, expect } from 'vitest'
import { normalizeFavs, toggleFav, FAV_LIMIT } from './favorites.js'

describe('normalizeFavs', () => {
  it('мусор из meta → пустой список', () => {
    expect(normalizeFavs(null)).toEqual([])
    expect(normalizeFavs({ a: 1 })).toEqual([])
    expect(normalizeFavs('bench')).toEqual([])
  })

  it('строки, без дублей и пустых, порядок сохраняется', () => {
    expect(normalizeFavs(['a', 'b', 'a', '', null, 7])).toEqual(['a', 'b', '7'])
  })

  it('не длиннее лимита', () => {
    const many = Array.from({ length: FAV_LIMIT + 5 }, (_, i) => `ex${i}`)
    expect(normalizeFavs(many)).toHaveLength(FAV_LIMIT)
  })
})

describe('toggleFav', () => {
  it('добавляет новое избранное В НАЧАЛО', () => {
    expect(toggleFav(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
    expect(toggleFav(null, 'a')).toEqual(['a'])
  })

  it('повторный тап снимает звезду, остальные на месте', () => {
    expect(toggleFav(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('при переполнении отваливается самое старое', () => {
    const full = Array.from({ length: FAV_LIMIT }, (_, i) => `ex${i}`)
    const next = toggleFav(full, 'new')
    expect(next).toHaveLength(FAV_LIMIT)
    expect(next[0]).toBe('new')
    expect(next).not.toContain(`ex${FAV_LIMIT - 1}`)
  })
})
