import { describe, it, expect } from 'vitest'
import { compareUserOrder, sortUsersByOrder } from './userOrder.js'

describe('sortUsersByOrder', () => {
  it('сортирует по sort_order по возрастанию', () => {
    const list = [
      { id: 'c', sort_order: 2 },
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
    ]
    expect(sortUsersByOrder(list).map((u) => u.id)).toEqual(['a', 'b', 'c'])
  })
  it('учётки без порядка (null) — в конец, без алфавита', () => {
    const list = [
      { id: 'noorder1', name: 'Яков', sort_order: null },
      { id: 'ordered', name: 'Борис', sort_order: 0 },
      { id: 'noorder2', name: 'Анна', sort_order: null },
    ]
    const ids = sortUsersByOrder(list).map((u) => u.id)
    expect(ids[0]).toBe('ordered')
    // без порядка идут после упорядоченного, тай-брейк по id (не по имени)
    expect(ids.slice(1)).toEqual(['noorder1', 'noorder2'])
  })
  it('оба без порядка → стабильно по id, а не по имени', () => {
    // имена убывают (Я,А), id возрастают → порядок должен быть по id
    const list = [
      { id: 'a', name: 'Яков', sort_order: null },
      { id: 'b', name: 'Анна', sort_order: null },
    ]
    expect(sortUsersByOrder(list).map((u) => u.id)).toEqual(['a', 'b'])
  })
  it('не мутирует исходный массив', () => {
    const list = [{ id: 'b', sort_order: 1 }, { id: 'a', sort_order: 0 }]
    sortUsersByOrder(list)
    expect(list.map((u) => u.id)).toEqual(['b', 'a'])
  })
  it('пусто/undefined → []', () => {
    expect(sortUsersByOrder(undefined)).toEqual([])
    expect(sortUsersByOrder([])).toEqual([])
  })
})

describe('compareUserOrder', () => {
  it('NaN sort_order трактуется как отсутствие порядка (в конец)', () => {
    const a = { id: 'a', sort_order: 'foo' }
    const b = { id: 'b', sort_order: 1 }
    expect(compareUserOrder(a, b)).toBe(1) // a в конец
    expect(compareUserOrder(b, a)).toBe(-1)
  })
})
