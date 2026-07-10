import { describe, it, expect } from 'vitest'
import { otherInPair, connectedIdsFor } from './connections.js'

describe('otherInPair', () => {
  it('возвращает второго участника пары', () => {
    expect(otherInPair({ low_id: 'a', high_id: 'b' }, 'a')).toBe('b')
    expect(otherInPair({ low_id: 'a', high_id: 'b' }, 'b')).toBe('a')
  })
  it('null, если пара не содержит участника', () => {
    expect(otherInPair({ low_id: 'a', high_id: 'b' }, 'z')).toBe(null)
    expect(otherInPair(null, 'a')).toBe(null)
  })
})

describe('connectedIdsFor', () => {
  const pairs = [
    { low_id: 'p', high_id: 'x', status: 'accepted' },
    { low_id: 'p', high_id: 'y', status: 'accepted' },
    { low_id: 'm', high_id: 'x', status: 'accepted' }, // без p
  ]
  it('собирает всех связанных с участником', () => {
    expect([...connectedIdsFor(pairs, 'p')].sort()).toEqual(['x', 'y'])
    expect([...connectedIdsFor(pairs, 'x')].sort()).toEqual(['m', 'p'])
  })
  it('игнорирует не-accepted и пустой вход', () => {
    const mixed = [{ low_id: 'p', high_id: 'z', status: 'pending' }]
    expect(connectedIdsFor(mixed, 'p').size).toBe(0)
    expect(connectedIdsFor(undefined, 'p').size).toBe(0)
  })
  it('status не указан → считаем связью (совместимость)', () => {
    expect(connectedIdsFor([{ low_id: 'p', high_id: 'q' }], 'p').has('q')).toBe(true)
  })
})
