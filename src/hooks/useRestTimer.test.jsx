// @vitest-environment jsdom
// useRestTimer — то, что не видно через WorkoutScreen.rest.test.jsx (покрытие тестами
// 19.10.2026): отдых переживает выгрузку PWA, сигнал не звучит задним числом, сигнал в
// свернутом приложении ждет возврата, экран держится только пока идет отдых.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRestTimer, restRunKey, restSettingsKey } from './useRestTimer.js'
import { playRestDone, holdScreen, releaseScreen } from '../lib/restSignal.js'
import { vibrate } from '../lib/haptics.js'
import { scheduleRestPush, cancelRestPush } from '../db/restPush.js'

vi.mock('../lib/restSignal.js', () => ({
  unlockRestAudio: vi.fn(), playRestDone: vi.fn(), holdScreen: vi.fn(), releaseScreen: vi.fn(),
}))
vi.mock('../lib/haptics.js', () => ({ vibrate: vi.fn(), HAPTIC: { restDone: [1] } }))
vi.mock('../db/restPush.js', () => ({ scheduleRestPush: vi.fn(), cancelRestPush: vi.fn() }))

const T0 = new Date('2026-10-19T12:00:00Z').getTime()
const EX = { id: 'ex1', name: 'Жим лежа' }
let visibility = 'visible'

function setVisible(v) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  localStorage.clear()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useRestTimer', () => {
  it('старт пишет запуск на устройство и ставит пуш с длительностью и упражнением', () => {
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    act(() => result.current.start(60))
    const run = JSON.parse(localStorage.getItem(restRunKey('u1')))
    expect(run).toMatchObject({ endsAt: T0 + 60_000, durMs: 60_000, exerciseId: 'ex1', exerciseName: 'Жим лежа' })
    expect(scheduleRestPush).toHaveBeenCalledWith('u1', expect.objectContaining({ inSec: 60 }))
    expect(result.current.state.phase).toBe('run')
  })

  it('отдых переживает выгрузку: новый экземпляр хука продолжает отсчет от endsAt', () => {
    localStorage.setItem(restRunKey('u1'), JSON.stringify({ endsAt: T0 + 30_000, durMs: 90_000 }))
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    expect(result.current.state.phase).toBe('run')
    expect(Math.round(result.current.state.leftMs / 1000)).toBe(30)
  })

  it('конец отдыха вживую — звук и вибро один раз', () => {
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    act(() => result.current.start(30))
    act(() => { vi.advanceTimersByTime(30_250) })
    expect(result.current.state.phase).toBe('done')
    expect(playRestDone).toHaveBeenCalledTimes(1)
    expect(playRestDone).toHaveBeenCalledWith('mix')
    expect(vibrate).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(playRestDone).toHaveBeenCalledTimes(1)
  })

  it('открыли приложение через 3,5 с после конца (позже порога сигнала) — задним числом не пищим', () => {
    localStorage.setItem(restRunKey('u1'), JSON.stringify({ endsAt: T0 - 3_500, durMs: 90_000 }))
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    expect(result.current.state.phase).toBe('done')
    expect(playRestDone).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('конец пришелся на свернутое приложение — решение при возврате, по опозданию', () => {
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    act(() => result.current.start(30))
    act(() => setVisible('hidden'))
    act(() => { vi.advanceTimersByTime(31_000) })
    expect(playRestDone).not.toHaveBeenCalled() // свернуто — тик стоит, звука нет
    vi.setSystemTime(T0 + 32_000) // вернулись через 2 с после конца (< REST_LATE_SIGNAL_MS)
    act(() => setVisible('visible'))
    expect(playRestDone).toHaveBeenCalledTimes(1)
  })

  it('открытое приложение снимает серверный пуш на последних секундах (сигнал даст само)', () => {
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    act(() => result.current.start(30))
    expect(cancelRestPush).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(27_000) })
    expect(cancelRestPush).toHaveBeenCalledWith('u1')
  })

  it('пуш выключен в настройках — ни постановки, ни отмены', () => {
    localStorage.setItem(restSettingsKey('u1'), JSON.stringify({ push: false }))
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    act(() => result.current.start(30))
    act(() => { vi.advanceTimersByTime(27_000) })
    expect(scheduleRestPush).not.toHaveBeenCalled()
    expect(cancelRestPush).not.toHaveBeenCalled()
  })

  it('экран держится, пока идет отдых, и отпускается после «Стоп»', () => {
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    expect(holdScreen).not.toHaveBeenCalled()
    act(() => result.current.start(60))
    expect(holdScreen).toHaveBeenCalledTimes(1)
    act(() => result.current.stop())
    expect(releaseScreen).toHaveBeenCalled()
    expect(localStorage.getItem(restRunKey('u1'))).toBeNull()
    expect(cancelRestPush).toHaveBeenCalledWith('u1')
  })

  it('таймер скрыли (дату перевели в прошлое) — идущий отдых снимается вместе с пушем', () => {
    const { result, rerender } = renderHook(({ active }) => useRestTimer('u1', { exercise: EX, active }), {
      initialProps: { active: true },
    })
    act(() => result.current.start(60))
    rerender({ active: false })
    expect(result.current.run).toBeNull()
    expect(cancelRestPush).toHaveBeenCalledWith('u1')
  })

  it('битое хранилище — дефолты, без падения', () => {
    localStorage.setItem(restSettingsKey('u1'), '{oops')
    localStorage.setItem(restRunKey('u1'), 'null')
    const { result } = renderHook(() => useRestTimer('u1', { exercise: EX }))
    expect(result.current.settings.on).toBe(true)
    expect(result.current.idleSec).toBe(90)
    expect(result.current.state.phase).toBe('idle')
  })
})
