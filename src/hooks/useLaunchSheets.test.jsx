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
vi.mock('../components/ui/Toast.jsx', () => ({ showToast: vi.fn() }))
// По умолчанию у сброса PIN нет своего бота — листа «Привяжи Telegram» нет (v7.5.0).
vi.mock('../lib/auth.js', () => ({
  getBotInfo: vi.fn(async () => ({ username: 'b', dedicated: false })),
  getRecoveryStatus: vi.fn(async () => ({ tgLinked: false, tgBot: null })),
}))

import { useLaunchSheets } from './useLaunchSheets.js'
import { SESSION_KEY } from './useSession.js'
import { SEEN_KEY } from '../lib/whatsNew.js'
import { markWelcomePending, welcomeKey } from '../lib/welcome.js'
import { markPushAsked } from '../db/push.js'
import { getBotInfo, getRecoveryStatus } from '../lib/auth.js'
import { showToast } from '../components/ui/Toast.jsx'
import { snoozeKey, SNOOZE_MS } from '../lib/tgLinkPrompt.js'

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

  it('привязан к старому боту — «перепривяжи» раньше пушей; «Позже» не прячет до след. запуска', async () => {
    vi.mocked(getBotInfo).mockResolvedValue({ username: 'kachalka_pin_bot', dedicated: true })
    vi.mocked(getRecoveryStatus).mockResolvedValue({ tgLinked: true, tgBot: 'notifier' })
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(result.current.tgAsk).toBe('relink')
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.pushAsk).toBe(false) // ждет, пока лист Telegram открыт
    act(() => result.current.closeTgAsk('later'))
    expect(result.current.tgAsk).toBeNull()
    expect(localStorage.getItem(snoozeKey('u1'))).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1300) })
    expect(result.current.pushAsk).toBe(true)
    // В этом запуске второй раз не спрашиваем.
    expect(getRecoveryStatus).toHaveBeenCalledTimes(1)
  })

  it('не привязан — «привяжи»; «Позже» прячет на 3 дня', async () => {
    vi.mocked(getBotInfo).mockResolvedValue({ username: 'kachalka_pin_bot', dedicated: true })
    vi.mocked(getRecoveryStatus).mockResolvedValue({ tgLinked: false, tgBot: null })
    const first = renderHook(() => useLaunchSheets(ME, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(first.result.current.tgAsk).toBe('link')
    act(() => first.result.current.closeTgAsk('later'))
    const until = Number(localStorage.getItem(snoozeKey('u1')))
    expect(until).toBeGreaterThanOrEqual(Date.now() + SNOOZE_MS - 1000)
    first.unmount()
    const again = renderHook(() => useLaunchSheets(ME, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(again.result.current.tgAsk).toBeNull()
  })

  it('привязал из листа — тост, лист закрыт', async () => {
    vi.mocked(getBotInfo).mockResolvedValue({ username: 'kachalka_pin_bot', dedicated: true })
    vi.mocked(getRecoveryStatus).mockResolvedValue({ tgLinked: false, tgBot: null })
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    act(() => result.current.closeTgAsk('linked'))
    expect(result.current.tgAsk).toBeNull()
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Telegram привязан' }))
  })

  it('без сети — не спрашиваем и не показываем', async () => {
    vi.mocked(getBotInfo).mockResolvedValue({ username: 'kachalka_pin_bot', dedicated: true })
    vi.mocked(getRecoveryStatus).mockRejectedValue(new Error('net'))
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(result.current.tgAsk).toBeNull()
  })

  it('без отметки регистрации (старый участник) приветствия нет', () => {
    const { result } = renderHook(() => useLaunchSheets(ME, false))
    expect(result.current.welcome).toBe(false)
  })
})
