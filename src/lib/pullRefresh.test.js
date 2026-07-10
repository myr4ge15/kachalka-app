import { describe, it, expect } from 'vitest'
import {
  pullDistance,
  shouldTriggerRefresh,
  PULL_THRESHOLD,
  PULL_MAX,
} from './pullRefresh.js'

describe('pullDistance', () => {
  it('тянем вниз — применяется сопротивление', () => {
    expect(pullDistance(100, { resistance: 0.5, max: 96 })).toBe(50)
    expect(pullDistance(40, { resistance: 0.5, max: 96 })).toBe(20)
  })

  it('упирается в потолок', () => {
    expect(pullDistance(1000, { resistance: 0.5, max: 96 })).toBe(96)
    expect(pullDistance(1000)).toBe(PULL_MAX)
  })

  it('вверх/ноль/отрицательное → 0', () => {
    expect(pullDistance(0)).toBe(0)
    expect(pullDistance(-50)).toBe(0)
  })

  it('дефолтные параметры применяются', () => {
    expect(pullDistance(10)).toBe(5) // 10 * 0.5
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
