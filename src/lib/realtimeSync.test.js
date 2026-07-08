import { describe, it, expect, vi } from 'vitest'
import {
  POLL_FAST_MS,
  POLL_SLOW_MS,
  pollIntervalFor,
  isRealtimeAlive,
  makeDebouncer,
} from './realtimeSync.js'

describe('pollIntervalFor', () => {
  it('живой Realtime → редкий опрос-страховка', () => {
    expect(pollIntervalFor(true)).toBe(POLL_SLOW_MS)
  })
  it('нет живого Realtime → частый опрос (как раньше)', () => {
    expect(pollIntervalFor(false)).toBe(POLL_FAST_MS)
  })
  it('страховочный интервал реже частого', () => {
    expect(POLL_SLOW_MS).toBeGreaterThan(POLL_FAST_MS)
  })
})

describe('isRealtimeAlive', () => {
  it('живой только на подтверждённой подписке', () => {
    expect(isRealtimeAlive('SUBSCRIBED')).toBe(true)
  })
  it('прочие статусы — не живой (страховочный опрос)', () => {
    for (const s of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', undefined, null, '']) {
      expect(isRealtimeAlive(s)).toBe(false)
    }
  })
})

describe('makeDebouncer', () => {
  it('всплеск триггеров сворачивается в один вызов', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = makeDebouncer(fn, 1000)
    d.trigger()
    d.trigger()
    d.trigger()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('повторный trigger сбрасывает таймер (trailing)', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = makeDebouncer(fn, 1000)
    d.trigger()
    vi.advanceTimersByTime(600)
    d.trigger() // сброс окна
    vi.advanceTimersByTime(600) // всего 1200, но с последнего триггера лишь 600
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('cancel снимает отложенный вызов', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = makeDebouncer(fn, 1000)
    d.trigger()
    d.cancel()
    vi.advanceTimersByTime(2000)
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('новый цикл после срабатывания работает независимо', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = makeDebouncer(fn, 1000)
    d.trigger()
    vi.advanceTimersByTime(1000)
    d.trigger()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
