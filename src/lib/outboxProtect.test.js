import { describe, it, expect } from 'vitest'
import { protectedFromPull } from './outboxProtect.js'

describe('protectedFromPull', () => {
  it('тумбстоны (_deleted) защищаются всегда', () => {
    const locals = [{ id: 't1', _deleted: true }]
    const got = protectedFromPull(locals, [])
    expect(got.has('t1')).toBe(true)
  })

  it('_dirty с ЖИВОЙ операцией в очереди — защищается', () => {
    const locals = [{ id: 't1', _dirty: true }]
    const ops = [{ templateId: 't1' }] // живая (нет _dead)
    expect(protectedFromPull(locals, ops).has('t1')).toBe(true)
  })

  it('_dirty без живой операции (только _dead) — НЕ защищается (самолечение)', () => {
    const locals = [{ id: 't1', _dirty: true }]
    const ops = [{ templateId: 't1', _dead: true }]
    expect(protectedFromPull(locals, ops).has('t1')).toBe(false)
  })

  it('_dirty без операций в очереди вовсе — НЕ защищается', () => {
    const locals = [{ id: 't1', _dirty: true }]
    expect(protectedFromPull(locals, []).has('t1')).toBe(false)
  })

  it('кастомный idOf (outbox использует workoutId)', () => {
    const locals = [{ id: 'w1', _dirty: true }]
    const ops = [{ workoutId: 'w1' }]
    const got = protectedFromPull(locals, ops, (o) => o.workoutId)
    expect(got.has('w1')).toBe(true)
  })

  it('пустые входы → пустой Set', () => {
    expect(protectedFromPull(undefined, undefined).size).toBe(0)
    expect(protectedFromPull([], []).size).toBe(0)
  })
})
