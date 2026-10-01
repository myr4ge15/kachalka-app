// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePushToggle } from './usePushToggle.js'
import { getPushState, enablePush, disablePush } from '../db/push.js'

vi.mock('../db/push.js', () => ({
  getPushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  getPushPrefs: vi.fn(() => Promise.resolve({})),
  setPushPref: vi.fn(),
}))

describe('usePushToggle (v6.7.1)', () => {
  beforeEach(() => {
    vi.mocked(getPushState).mockReset().mockResolvedValue({ availability: 'ok', enabled: false })
    vi.mocked(enablePush).mockReset()
    vi.mocked(disablePush).mockReset().mockResolvedValue()
  })

  it('включение: тумблер встает сразу и не откатывается, даже если браузер еще не видит подписку', async () => {
    let finish
    vi.mocked(enablePush).mockImplementation(() => new Promise((r) => { finish = r }))
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.availability).toBe('ok'))
    act(() => { result.current.toggle(true) })
    expect(result.current.enabled).toBe(true) // оптимистично, до ответа сервера
    expect(result.current.busy).toBe(true)
    await act(async () => { finish() })
    expect(result.current.busy).toBe(false)
    expect(result.current.enabled).toBe(true)
    // после успеха состояние браузера не перечитываем (getSubscription на iPhone отстает)
    expect(getPushState).toHaveBeenCalledTimes(1)
  })

  it('ошибка включения — откат и текст ошибки', async () => {
    vi.mocked(enablePush).mockRejectedValue(new Error('Разрешение не выдано.'))
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.availability).toBe('ok'))
    await act(async () => { await result.current.toggle(true) })
    expect(result.current.enabled).toBe(false)
    expect(result.current.error).toBe('Разрешение не выдано.')
  })

  it('выключение не ждет сервер', async () => {
    vi.mocked(getPushState).mockResolvedValue({ availability: 'ok', enabled: true })
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => { await result.current.toggle(false) })
    expect(disablePush).toHaveBeenCalledWith('me', { background: true })
    expect(result.current.enabled).toBe(false)
  })

  it('повторный тап во время переключения игнорируется', async () => {
    let finish
    vi.mocked(enablePush).mockImplementation(() => new Promise((r) => { finish = r }))
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.availability).toBe('ok'))
    act(() => { result.current.toggle(true) })
    act(() => { result.current.toggle(false) })
    expect(enablePush).toHaveBeenCalledTimes(1)
    expect(disablePush).not.toHaveBeenCalled()
    await act(async () => { finish() })
  })
})
