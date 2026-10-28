import { describe, it, expect } from 'vitest'
import {
  pullDistance,
  shouldTriggerRefresh,
  PULL_THRESHOLD,
  PULL_MAX,
  PULL_RESISTANCE,
} from './pullRefresh.js'

describe('pullDistance', () => {
  it('в начале экран идет почти за пальцем — с наклоном resistance', () => {
    expect(pullDistance(1)).toBeCloseTo(PULL_RESISTANCE, 2)
    expect(pullDistance(10, { resistance: 0.5, max: 100 })).toBeCloseTo(4.88, 2)
  })

  it('дальше тянется все туже и не доходит до max (без жесткого упора, fb_f8a87f1a)', () => {
    const a = pullDistance(100)
    const b = pullDistance(200)
    const c = pullDistance(300)
    expect(b - a).toBeLessThan(a)       // вторые 100 px пальца дают меньше первых
    expect(c - b).toBeLessThan(b - a)
    expect(c).toBeGreaterThan(b)        // но экран все еще идет
    expect(pullDistance(5000)).toBeLessThanOrEqual(PULL_MAX)
    expect(pullDistance(5000)).toBeGreaterThan(PULL_MAX - 1)
  })

  it('порог достижим обычным жестом: ~130–170 px пальца', () => {
    expect(pullDistance(120)).toBeLessThan(PULL_THRESHOLD)
    expect(pullDistance(180)).toBeGreaterThanOrEqual(PULL_THRESHOLD)
  })

  it('вверх/ноль/отрицательное → 0', () => {
    expect(pullDistance(0)).toBe(0)
    expect(pullDistance(-50)).toBe(0)
  })
})

describe('shouldTriggerRefresh', () => {
  it('на пороге и выше — срабатывает', () => {
    expect(shouldTriggerRefresh(PULL_THRESHOLD)).toBe(true)
    expect(shouldTriggerRefresh(PULL_THRESHOLD + 10)).toBe(true)
  })

  it('ниже порога — нет', () => {
    expect(shouldTriggerRefresh(PULL_THRESHOLD - 1)).toBe(false)
    expect(shouldTriggerRefresh(0)).toBe(false)
  })

  it('кастомный порог', () => {
    expect(shouldTriggerRefresh(30, 20)).toBe(true)
    expect(shouldTriggerRefresh(10, 20)).toBe(false)
  })
})
