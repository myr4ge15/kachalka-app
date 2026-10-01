import { describe, it, expect } from 'vitest'
import { spinPhaseStyle } from './spinPhase.js'

describe('spinPhaseStyle', () => {
  it('отрицательная задержка = время документа (общая фаза для всех крутилок)', () => {
    expect(spinPhaseStyle(1234.4)).toEqual({ '--spin-phase': '-1234ms' })
  })
  it('без времени — нулевая фаза, без NaN', () => {
    expect(spinPhaseStyle(0)).toEqual({ '--spin-phase': '-0ms' })
    expect(spinPhaseStyle(-5)).toEqual({ '--spin-phase': '-0ms' })
  })
})
