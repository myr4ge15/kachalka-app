// @vitest-environment jsdom
// Листы после входа (v6.14.1, вынесены из App.jsx): «Что нового» и вопрос про пуши.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../db/push.js', () => ({
  getPushState: vi.fn(async () => ({})),
  wasPushAsked: vi.fn(() => false),
  markPushAsked: vi.fn(),
}))
vi.mock('../lib/pushSupport.js', () => ({ shouldAskPush: vi.fn(() => true) }))
vi.mock('../components/Toast.jsx', () => ({ showToast: vi.fn() }))

import { useLaunchSheets } from './useLaunchSheets.js'
import { SESSION_KEY } from './useSession.js'
import { SEEN_KEY } from '../lib/whatsNew.js'
import { markWelcomePending, welcomeKey } from '../lib/welcome.js'
import { markPushAsked } from '../db/push.js'

const ME = { id: 'u1', name: 'Дима' }
beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('useLaunchSheets', () => {
  it('новое устройство — лист не показываем, версию молча запоминаем', () => {
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    expect(result.current.whatsNew).toBeNull()
    expect(localStorage.getItem(SEEN_KEY)).toBeTruthy()
  })

  it('знакомое устройство со старой отметкой — лист; закрытие пишет текущую версию', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: 'u1' }))
    localStorage.setItem(SEEN_KEY, '1.0.0')
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    expect(result.current.whatsNew).toBeTruthy()
    act(() => result.current.closeWhatsNew())
    expect(result.current.whatsNew).toBeNull()
    expect(localStorage.getItem(SEEN_KEY)).not.toBe('1.0.0')
  })

  it('вопрос про пуши — не во время записи тренировки; «Не сейчас» больше не спросит', async () => {
    const { result, rerender } = renderHook(({ busy }) => useLaunchSheets(ME, busy), { initialProps: { busy: true } })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.pushAsk).toBe(false)
    rerender({ busy: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(1300) })
    expect(result.current.pushAsk).toBe(true)
    act(() => result.current.closePushAsk(false))
    expect(result.current.pushAsk).toBe(false)
    expect(markPushAsked).toHaveBeenCalledWith('u1')
  })

  it('новичок после регистрации — «Добро пожаловать»; вопрос про пуши ждет, пока лист открыт', async () => {
    markWelcomePending('u1')
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    expect(result.current.welcome).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.pushAsk).toBe(false)
    act(() => result.current.closeWelcome())
    expect(result.current.welcome).toBe(false)
    expect(localStorage.getItem(welcomeKey('u1'))).toBe('done')
    await act(async () => { await vi.advanceTimersByTimeAsync(1300) })
    expect(result.current.pushAsk).toBe(true)
  })

  it('без отметки регистрации (старый участник) приветствия нет', () => {
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    expect(result.current.welcome).toBe(false)
  })
})
