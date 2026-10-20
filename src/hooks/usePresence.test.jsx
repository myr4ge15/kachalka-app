// @vitest-environment jsdom
// «В сети» (hooks/usePresence.js; покрытие тестами 20.10.2026: ветки 17 %): отметка «я тут» и
// опрос — только пока приложение на экране; свернули — тишина, вернулись — сразу; пол из
// ростера для «был/была».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePresence, usePresenceHeartbeat, useRosterSex } from './usePresence.js'
import { refreshPresence, touchPresence } from '../db/presence.js'

// Снимок — один и тот же объект, как у настоящего стора (иначе useSyncExternalStore зациклится).
const SNAP = vi.hoisted(() => new Map([['u1', '2026-10-20T10:00:00Z']]))
vi.mock('../db/presence.js', () => ({
  getPresence: () => SNAP,
  subscribePresence: () => () => {},
  refreshPresence: vi.fn(),
  touchPresence: vi.fn(),
  FETCH_EVERY_MS: 60_000,
  TOUCH_EVERY_MS: 120_000,
}))
vi.mock('../db/repo.js', () => ({ getUsers: vi.fn() }))
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => [{ id: 'u1', sex: 'f' }, { id: 'u2', sex: null }, { id: 'u3', sex: 'm' }],
}))

let hidden = false
beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true })
})
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

const setHidden = (v) => { hidden = v; document.dispatchEvent(new Event('visibilitychange')) }

describe('usePresenceHeartbeat', () => {
  it('сразу и по таймеру; свернуто — молчит; вернулись и «снова онлайн» — сразу', () => {
    const { unmount } = renderHook(() => usePresenceHeartbeat('me'))
    expect(touchPresence).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(120_000)
    expect(touchPresence).toHaveBeenCalledTimes(2)
    setHidden(true)
    vi.advanceTimersByTime(600_000)
    expect(touchPresence).toHaveBeenCalledTimes(2)
    setHidden(false)
    expect(touchPresence).toHaveBeenCalledTimes(3)
    window.dispatchEvent(new Event('online'))
    expect(touchPresence).toHaveBeenCalledTimes(4)
    unmount()
    vi.advanceTimersByTime(600_000)
    window.dispatchEvent(new Event('online'))
    expect(touchPresence).toHaveBeenCalledTimes(4) // после ухода — ни таймера, ни слушателей
  })
})

describe('usePresence / useRosterSex', () => {
  it('отметки из снимка, опрос по таймеру', () => {
    const { result } = renderHook(() => usePresence('me'))
    expect(result.current.get('u1')).toBe('2026-10-20T10:00:00Z')
    expect(refreshPresence).toHaveBeenCalledWith('me')
    vi.advanceTimersByTime(60_000)
    expect(refreshPresence).toHaveBeenCalledTimes(2)
  })
  it('пол — только у кого задан', () => {
    const { result } = renderHook(() => useRosterSex())
    expect([...result.current]).toEqual([['u1', 'f'], ['u3', 'm']])
  })
})
