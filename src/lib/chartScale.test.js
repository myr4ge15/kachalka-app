import { describe, expect, it } from 'vitest'
import { niceScale } from './chartScale.js'

describe('niceScale — круглые деления оси (аудит 16.10)', () => {
  it('жим 92…105 с целью 110: шаг 5, а не 98 / 107 / 115', () => {
    const s = niceScale([92, 100, 105, 110], { pad: 5 })
    expect(s.ticks.every((t) => t % 5 === 0)).toBe(true)
    expect(s.domain[0]).toBeLessThanOrEqual(87)
    expect(s.domain[1]).toBeGreaterThanOrEqual(115)
    expect(s.ticks.length).toBeLessThanOrEqual(5)
  })

  it('повторы 8…15: целые деления, не ниже нуля', () => {
    const s = niceScale([8, 12, 15], { pad: 2 })
    expect(s.ticks).toEqual([5, 10, 15, 20])
    expect(s.domain).toEqual([5, 20])
  })

  it('время (секунды): шаг из привычных — 15 с, 30 с, минута', () => {
    const s = niceScale([60, 95, 150], { pad: 2, time: true })
    expect([15, 30, 60]).toContain(s.ticks[1] - s.ticks[0])
    expect(s.domain[0]).toBeLessThanOrEqual(58)
    expect(s.domain[1]).toBeGreaterThanOrEqual(152)
  })

  it('одно значение и пустой ряд — не ломаются', () => {
    expect(niceScale([50]).domain[1]).toBeGreaterThan(50)
    expect(niceScale([])).toEqual({ domain: [0, 1], ticks: [0, 1] })
    expect(niceScale([0, 0])).toEqual({ domain: [0, 1], ticks: [0, 0.5, 1] })
  })
})
