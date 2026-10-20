// @vitest-environment jsdom
// usePushToggle — настройки по типам и связь экземпляров (покрытие тестами 20.10.2026:
// ветки 31 %). Тип переключается сразу, при ошибке откатывается ТОЛЬКО он; строка
// Настроек и экран «Пуш-уведомления» видят изменения друг друга; браузер без поддержки
// и возврат из настроек телефона.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePushToggle } from './usePushToggle.js'
import { getPushState, enablePush, getPushPrefs, setPushPref } from '../db/push.js'

vi.mock('../db/push.js', () => ({
  getPushState: vi.fn(),
  enablePush: vi.fn(async () => {}),
  disablePush: vi.fn(async () => {}),
  getPushPrefs: vi.fn(),
  setPushPref: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(getPushState).mockReset().mockResolvedValue({ availability: 'ok', enabled: true })
  vi.mocked(getPushPrefs).mockReset().mockResolvedValue({ reaction: true, comment: true })
  vi.mocked(setPushPref).mockReset()
})
afterEach(() => vi.clearAllMocks())

describe('usePushToggle — типы', () => {
  it('пуши включены — настройки по типам загружаются', async () => {
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.prefs).toEqual({ reaction: true, comment: true }))
    expect(getPushPrefs).toHaveBeenCalledWith('me')
  })

  it('не загрузились — текст ошибки', async () => {
    vi.mocked(getPushPrefs).mockRejectedValue(new Error('Нет сети.'))
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.prefsError).toBe('Нет сети.'))
    expect(result.current.prefs).toBeNull()
  })

  it('тип переключается сразу, сохраненное с сервера заменяет оптимистичное', async () => {
    let finish
    vi.mocked(setPushPref).mockImplementation(() => new Promise((r) => { finish = r }))
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.prefs).not.toBeNull())
    act(() => { result.current.setType('comment', false) })
    expect(result.current.prefs.comment).toBe(false)
    expect(result.current.prefsBusy).toBe('comment')
    await act(async () => { finish({ reaction: true, comment: false, record: true }) })
    expect(result.current.prefs).toEqual({ reaction: true, comment: false, record: true })
    expect(result.current.prefsBusy).toBeNull()
    expect(setPushPref).toHaveBeenCalledWith('me', 'comment', false)
  })

  it('ошибка сохранения — откат только своего тумблера, соседний не трогаем', async () => {
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.prefs).not.toBeNull())
    vi.mocked(setPushPref).mockRejectedValueOnce(new Error('Сессия устарела'))
    vi.mocked(setPushPref).mockResolvedValueOnce({ reaction: false, comment: true })
    await act(async () => {
      await Promise.all([result.current.setType('comment', false), result.current.setType('reaction', false)])
    })
    expect(result.current.prefs.comment).toBe(true) // откатили
    expect(result.current.prefsError).toBe('Сессия устарела')
  })
})

describe('usePushToggle — экземпляры и браузер', () => {
  it('изменение в одном экземпляре видит другой (строка Настроек ↔ экран), чужая учетка — нет', async () => {
    vi.mocked(getPushState).mockResolvedValue({ availability: 'ok', enabled: false })
    const row = renderHook(() => usePushToggle('me'))
    const screen = renderHook(() => usePushToggle('me'))
    const other = renderHook(() => usePushToggle('someone'))
    await waitFor(() => expect(screen.result.current.availability).toBe('ok'))
    await act(async () => { await screen.result.current.toggle(true) })
    expect(enablePush).toHaveBeenCalledWith('me')
    expect(row.result.current.enabled).toBe(true)
    expect(other.result.current.enabled).toBe(false)
    vi.mocked(setPushPref).mockResolvedValue({ comment: false })
    await waitFor(() => expect(screen.result.current.prefs).not.toBeNull())
    await act(async () => { await screen.result.current.setType('comment', false) })
    expect(row.result.current.prefs).toEqual({ comment: false })
  })

  it('браузер не умеет пуши (сбой проверки) — «не поддерживается», без падения', async () => {
    vi.mocked(getPushState).mockRejectedValue(new Error('no SW'))
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.availability).toBe('unsupported'))
    expect(result.current.enabled).toBe(false)
  })

  it('вернулись из настроек телефона — состояние перечитывается', async () => {
    const { result } = renderHook(() => usePushToggle('me'))
    await waitFor(() => expect(result.current.availability).toBe('ok'))
    vi.mocked(getPushState).mockResolvedValue({ availability: 'denied', enabled: false })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(result.current.availability).toBe('denied'))
  })
})
