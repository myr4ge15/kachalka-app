import { describe, it, expect } from 'vitest'
import {
  normalizeName,
  similarityScore,
  findSimilar,
  findExactDuplicate,
} from './similar.js'

describe('normalizeName', () => {
  it('нижний регистр, ё→е, схлопывание пробелов, обрезка пунктуации', () => {
    expect(normalizeName('Жим Лёжа')).toBe('жим лежа')
    expect(normalizeName('  жим   лежа  ')).toBe('жим лежа')
    expect(normalizeName('жим-лёжа, штангой!')).toBe('жим лежа штангой')
  })
  it('null/undefined → пустая строка', () => {
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})

describe('similarityScore', () => {
  it('точное совпадение после нормализации → 1', () => {
    expect(similarityScore('Жим лёжа', 'жим лежа')).toBe(1)
  })
  it('опечатка ловится символьной метрикой', () => {
    expect(similarityScore('жим лежа', 'жим лжа')).toBeGreaterThan(0.45)
  })
  it('осмысленная подстрока — сильный сигнал', () => {
    expect(similarityScore('жим лежа', 'жим лежа узким хватом')).toBeGreaterThanOrEqual(0.6)
  })
  it('одно общее короткое слово — НЕ дубль', () => {
    // «жим» ⊂ многих; не должен ложно матчить «жим ногами»
    expect(similarityScore('жим', 'жим ногами')).toBeLessThan(0.45)
  })
  it('пустые → 0', () => {
    expect(similarityScore('', 'жим')).toBe(0)
  })
})

describe('findSimilar', () => {
  const ex = [
    { id: '1', name: 'Жим лёжа' },
    { id: '2', name: 'Жим ногами' },
    { id: '3', name: 'Приседания' },
  ]
  it('находит похожее (ё/е, опечатки), сортирует по убыванию', () => {
    const res = findSimilar('жим лежа штангой', ex)
    expect(res[0].id).toBe('1')
  })
  it('слишком короткий запрос (<2) → []', () => {
    expect(findSimilar('ж', ex)).toEqual([])
  })
  it('нет похожих → []', () => {
    expect(findSimilar('становая тяга', ex)).toEqual([])
  })
})

describe('findExactDuplicate', () => {
  const ex = [{ id: '1', name: 'Жим лёжа' }]
  it('находит точный дубль после нормализации', () => {
    expect(findExactDuplicate('жим лежа', ex)?.id).toBe('1')
  })
  it('нет дубля → null', () => {
    expect(findExactDuplicate('присед', ex)).toBeNull()
    expect(findExactDuplicate('', ex)).toBeNull()
  })
})
