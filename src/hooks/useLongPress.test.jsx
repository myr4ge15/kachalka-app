// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLongPress } from './useLongPress.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useLongPress', () => {
  const target = { clientX: 10, clientY: 10, currentTarget: { id: 'reaction' } }

  it.each(['onPointerUp', 'onPointerCancel', 'onPointerLeave'])('%s завершает удержание один раз', (release) => {
    const onLong = vi.fn()
    const onEnd = vi.fn()
    const { result } = renderHook(() => useLongPress(onLong, { onEnd }))
    const handlers = result.current.bind('like')
    handlers.onPointerDown(target)
    vi.advanceTimersByTime(449)
    expect(onLong).not.toHaveBeenCalled()
    handlers.onPointerMove({ clientX: 13, clientY: 14 })
    vi.advanceTimersByTime(1)
    expect(onLong).toHaveBeenCalledExactlyOnceWith('like', target.currentTarget)
    handlers.onPointerMove({ clientX: 100, clientY: 100 })
    handlers[release]()
    handlers[release]()
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('like')
    expect(result.current.wasLong()).toBe(true)
    expect(result.current.wasLong()).toBe(false)
  })

  it('сдвиг, раннее отпускание и уход с экрана отменяют таймер', () => {
    const onLong = vi.fn()
    const onEnd = vi.fn()
    const { result, unmount } = renderHook(() => useLongPress(onLong, { ms: 200, slop: 6, onEnd }))
    const handlers = result.current.bind('like')
    handlers.onPointerMove({ clientX: 100, clientY: 100 })
    handlers.onPointerDown(target)
    handlers.onPointerMove({ clientX: 17, clientY: 10 })
    vi.advanceTimersByTime(200)
    handlers.onPointerDown(target)
    handlers.onPointerUp()
    vi.advanceTimersByTime(200)
    handlers.onPointerDown(target)
    unmount()
    vi.advanceTimersByTime(200)
    expect(onLong).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('подавляет системное меню и допускает удержание без обработчиков', () => {
    const { result } = renderHook(() => useLongPress())
    const handlers = result.current.bind()
    const preventDefault = vi.fn()
    handlers.onContextMenu({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    handlers.onPointerDown(target)
    vi.advanceTimersByTime(450)
    handlers.onPointerUp()
    expect(result.current.wasLong()).toBe(true)
  })
})
