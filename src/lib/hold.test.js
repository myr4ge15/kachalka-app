import { describe, it, expect } from 'vitest'
import { nextHoldDelay, HOLD_START, HOLD_MIN, HOLD_STEP } from './hold.js'

describe('nextHoldDelay', () => {
  it('первый повтор (нет prev) → HOLD_START - HOLD_STEP', () => {
    expect(nextHoldDelay(undefined)).toBe(HOLD_START - HOLD_STEP)
    expect(nextHoldDelay(null)).toBe(HOLD_START - HOLD_STEP)
  })

  it('каждый следующий короче на HOLD_STEP', () => {
    expect(nextHoldDelay(300)).toBe(275)
    expect(nextHoldDelay(275)).toBe(250)
  })

  it('не опускается ниже HOLD_MIN (пол)', () => {
    expect(nextHoldDelay(HOLD_MIN + HOLD_STEP - 1)).toBe(HOLD_MIN) // чуть выше пола → пол
    expect(nextHoldDelay(HOLD_MIN)).toBe(HOLD_MIN)
    expect(nextHoldDelay(10)).toBe(HOLD_MIN) // уже ниже пола → остаёмся на полу
  })

  it('КРАЙ: prev=0 трактуется как falsy → сброс на HOLD_START (Number(0)||HOLD_START)', () => {
    // осознанный нюанс реализации: 0 → падаем на HOLD_START, а не считаем «−HOLD_STEP от нуля».
    // На практике delay=0 не возникает (минимум — HOLD_MIN), но фиксируем поведение тестом.
    expect(nextHoldDelay(0)).toBe(HOLD_START - HOLD_STEP)
  })

  it('строго убывает от старта до пола за конечное число шагов', () => {
    let d = HOLD_START
    const seen = [d]
    for (let i = 0; i < 100; i++) {
      const n = nextHoldDelay(d)
      expect(n).toBeLessThanOrEqual(d)
      expect(n).toBeGreaterThanOrEqual(HOLD_MIN)
      d = n
      seen.push(d)
    }
    expect(d).toBe(HOLD_MIN) // дошли до пола и держимся
  })
})
