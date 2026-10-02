// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScrollAnchorRestore } from './useScrollAnchor.js'

describe('useScrollAnchorRestore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'] })
  })
  afterEach(() => vi.useRealTimers())

  function setup(snap) {
    const ref = { current: document.createElement('div') }
    const onDone = vi.fn()
    renderHook(() => useScrollAnchorRestore(ref, snap, onDone))
    return onDone
  }

  it('обычный возврат подгоняет прокрутку ~1 с', () => {
    const onDone = setup({ anchor: null, offset: 0, scrollTop: 0 })
    vi.advanceTimersByTime(800)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('якорь из пуша ждет дольше (snap.ms) — холодный старт', () => {
    const onDone = setup({ anchor: 'feed-w1', offset: 12, scrollTop: 0, ms: 2500 })
    vi.advanceTimersByTime(1500)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1200)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
