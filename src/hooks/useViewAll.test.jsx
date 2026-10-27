// @vitest-environment jsdom
// «Видеть всех» (27.10.2026): сверка только у админа (вход, возврат в приложение), конец срока — по таймеру,
// снимок наружу — пока режим идет; «чужие» — Set.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
const api = vi.hoisted(() => ({ state: null, refresh: vi.fn() }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (fn) => fn() }))
vi.mock('../db/adminViewAll.js', () => ({
  getViewAll: () => api.state,
  refreshViewAll: (...a) => api.refresh(...a),
}))
import { useViewAllExtra, useViewAllWatch } from './useViewAll.js'

const soon = (ms) => new Date(Date.now() + ms).toISOString()
beforeEach(() => { api.state = null; api.refresh.mockReset() })
afterEach(() => vi.useRealTimers())

describe('useViewAllWatch', () => {
  it('не админ — без сверки и без снимка', async () => {
    api.state = { until: soon(60000), extra: [] }
    const { result } = renderHook(() => useViewAllWatch({ id: 'u', role: 'member' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(api.refresh).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('админ: сверка при входе и при возврате в приложение; идущий режим — наружу', async () => {
    api.state = { until: soon(60000), extra: ['st'] }
    const { result } = renderHook(() => useViewAllWatch({ id: 'a', role: 'admin' }))
    await waitFor(() => expect(result.current?.until).toBe(api.state.until))
    expect(api.refresh).toHaveBeenCalledWith('a')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(api.refresh).toHaveBeenCalledTimes(2)
  })

  it('конец срока — еще одна сверка по таймеру; истекший снимок наружу не отдаем', async () => {
    api.state = { until: soon(-1000), extra: [] }
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useViewAllWatch({ id: 'a', role: 'admin' }))
    await waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(1))
    expect(result.current).toBeNull()
    await vi.advanceTimersByTimeAsync(1100)
    expect(api.refresh).toHaveBeenCalledTimes(2)
  })
})

describe('useViewAllExtra', () => {
  it('«чужие» из снимка; без режима — пусто', async () => {
    api.state = { until: soon(60000), extra: ['st', 'x'] }
    const { result } = renderHook(() => useViewAllExtra())
    expect([...result.current]).toEqual(['st', 'x'])
    api.state = null
    expect(renderHook(() => useViewAllExtra()).result.current.size).toBe(0)
  })
})
