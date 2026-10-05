// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSpinPhase } from './useSpinPhase.js'

describe('useSpinPhase', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('выключена — стиль не нужен', () => {
    const { result } = renderHook(() => useSpinPhase(false))
    expect(result.current).toBeUndefined()
  })

  it('фаза снимается один раз при включении и не плывет на перерисовках', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1234.4)
    const { result, rerender } = renderHook(({ on }) => useSpinPhase(on), { initialProps: { on: true } })
    expect(result.current).toEqual({ '--spin-phase': '-1234ms' })
    const first = result.current
    now.mockReturnValue(5000)
    rerender({ on: true })
    expect(result.current).toBe(first)
    rerender({ on: false })
    expect(result.current).toBeUndefined()
    rerender({ on: true }) // новое включение — новая фаза
    expect(result.current).toEqual({ '--spin-phase': '-5000ms' })
  })
})
