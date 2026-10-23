// Журнал свайпов (23.10.2026): последние N жестов в localStorage, строка для экрана, сбои хранилища молчат.
import { describe, expect, it } from 'vitest'
import { clearSwipeLog, logSwipe, readSwipeLog, swipeLogLine, SWIPE_LOG_MAX } from './swipeLog.js'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }

describe('swipeLog', () => {
  it('свежие сверху, не больше SWIPE_LOG_MAX; очистка', () => {
    const s = mem()
    for (let i = 0; i < SWIPE_LOG_MAX + 5; i++) logSwipe({ kind: 'back', p: i / 100 }, s)
    const list = readSwipeLog(s)
    expect(list).toHaveLength(SWIPE_LOG_MAX)
    expect(list[0].p).toBe((SWIPE_LOG_MAX + 4) / 100)
    clearSwipeLog(s)
    expect(readSwipeLog(s)).toEqual([])
  })
  it('сломанное хранилище — пусто и без падения', () => {
    const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } }
    expect(() => logSwipe({ kind: 'back' }, bad)).not.toThrow()
    expect(readSwipeLog(bad)).toEqual([])
    expect(() => clearSwipeLog(bad)).not.toThrow()
    expect(readSwipeLog({ getItem: () => '{"a":1}' })).toEqual([])
  })
  it('строка: исход, процент, скорости, точки, причина', () => {
    const line = swipeLogLine({ at: '2026-10-23T10:40:00Z', kind: 'back', p: 0.18, v: 0.123, flick: 0.456, moves: 7, why: 'прокрутка забирала 2' })
    expect(line).toMatch(/вернулся · 18% · 0,12 \/ 0,46 px\/мс · 7 точек · прокрутка забирала 2$/)
    expect(swipeLogLine({ at: 'нет', kind: 'cancel' })).toMatch(/^— · прерван · 0%/)
  })
})
