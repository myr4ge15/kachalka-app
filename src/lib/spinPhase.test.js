import { describe, it, expect, vi } from 'vitest'
import { spinPhaseStyle } from './spinPhase.js'

describe('spinPhaseStyle', () => {
  it('отрицательная задержка = время документа (общая фаза для всех крутилок)', () => {
    expect(spinPhaseStyle(1234.4)).toEqual({ '--spin-phase': '-1234ms' })
  })
  it('без явного времени берет время документа', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(125.6)
    try {
      expect(spinPhaseStyle()).toEqual({ '--spin-phase': '-126ms' })
    } finally {
      now.mockRestore()
    }
  })

  it('без часов документа использует нулевую фазу', () => {
    vi.stubGlobal('performance', undefined)
    try {
      expect(spinPhaseStyle()).toEqual({ '--spin-phase': '-0ms' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('отрицательное время ограничивает нулем', () => {
    expect(spinPhaseStyle(-5)).toEqual({ '--spin-phase': '-0ms' })
  })
})
