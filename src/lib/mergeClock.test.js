import { describe, it, expect } from 'vitest'
import { mergeDecision } from './mergeClock.js'

const T0 = '2026-06-30T10:00:00.000Z'
const T1 = '2026-06-30T11:00:00.000Z'
const T2 = '2026-06-30T12:00:00.000Z'

describe('mergeDecision', () => {
  it('чистая запись (нет _dirty) → take-server', () => {
    expect(
      mergeDecision({ dirty: false, deleted: false, baseUpdatedAt: T0, serverUpdatedAt: T1 })
    ).toBe('take-server')
  })

  it('тумбстон (_deleted) → keep-local, сильнее часов', () => {
    expect(
      mergeDecision({ dirty: false, deleted: true, baseUpdatedAt: T0, serverUpdatedAt: T2 })
    ).toBe('keep-local')
    // даже если ещё и dirty — удаление побеждает
    expect(
      mergeDecision({ dirty: true, deleted: true, baseUpdatedAt: T0, serverUpdatedAt: T2 })
    ).toBe('keep-local')
  })

  it('dirty, сервер старше базиса → keep-local (наша правка свежее)', () => {
    expect(
      mergeDecision({ dirty: true, deleted: false, baseUpdatedAt: T1, serverUpdatedAt: T0 })
    ).toBe('keep-local')
  })

  it('dirty, сервер РАВЕН базису (наша же уехавшая правка) → keep-local', () => {
    expect(
      mergeDecision({ dirty: true, deleted: false, baseUpdatedAt: T1, serverUpdatedAt: T1 })
    ).toBe('keep-local')
  })

  it('dirty, сервер новее базиса → conflict (правка с другого устройства)', () => {
    expect(
      mergeDecision({ dirty: true, deleted: false, baseUpdatedAt: T0, serverUpdatedAt: T1 })
    ).toBe('conflict')
  })

  it('dirty без базиса (локально созданная запись) → keep-local', () => {
    expect(
      mergeDecision({ dirty: true, deleted: false, baseUpdatedAt: null, serverUpdatedAt: T1 })
    ).toBe('keep-local')
    expect(
      mergeDecision({ dirty: true, deleted: false, baseUpdatedAt: undefined, serverUpdatedAt: T1 })
    ).toBe('keep-local')
  })

  it('dirty, строка со старого сервера без updated_at → keep-local', () => {
    expect(
      mergeDecision({ dirty: true, deleted: false, baseUpdatedAt: T0, serverUpdatedAt: null })
    ).toBe('keep-local')
    expect(
      mergeDecision({ dirty: true, deleted: false, baseUpdatedAt: T0, serverUpdatedAt: undefined })
    ).toBe('keep-local')
  })
})
