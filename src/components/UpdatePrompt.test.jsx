// @vitest-environment jsdom
// РЕВЬЮ-КОДА-2026-10-02: новый sw.js уже скачан, а version.json с CDN еще старый —
// плашка гасла до следующего запуска. Теперь check() перепроверяет версию.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import UpdatePrompt, { RECHECK_MIN_MS, shouldRecheckWaiting } from './UpdatePrompt.jsx'
import { shouldSurfaceWaiting } from '../lib/pwaUpdate.js'

const reg = { waiting: {}, update: vi.fn(() => Promise.resolve()) }
const updateServiceWorker = vi.fn()
// initial — поднял ли workbox needRefresh сам (false — событие `waiting` пропущено).
const swState = { initial: true }
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: ({ onRegisteredSW }) => {
    const [needRefresh, setNeedRefresh] = useState(swState.initial)
    onRegisteredSW('/sw.js', reg)
    return { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker }
  },
}))
const resume = { fn: null }
vi.mock('../lib/appEvents.js', () => ({
  onResume: (fn) => { resume.fn = fn; return () => {} },
  onOnline: () => () => {},
}))

describe('shouldRecheckWaiting', () => {
  const base = { hasWaiting: true, hidden: true, quiet: true, lastAt: 1000, now: 1000 + RECHECK_MIN_MS }
  it('перепроверяет ждущий SW, спрятанный сверкой версии, не чаще порога', () => {
    expect(shouldRecheckWaiting(base)).toBe(true)
    expect(shouldRecheckWaiting({ ...base, now: base.now - 1 })).toBe(false)
  })
  it('не трогает: нет ждущего SW, плашка видна, спрятана «Позже»', () => {
    expect(shouldRecheckWaiting({ ...base, hasWaiting: false })).toBe(false)
    expect(shouldRecheckWaiting({ ...base, hidden: false })).toBe(false)
    expect(shouldRecheckWaiting({ ...base, quiet: false })).toBe(false)
  })
})

describe('UpdatePrompt — отстающий version.json', () => {
  let serverVersion
  beforeEach(() => {
    serverVersion = __APP_VERSION__
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: serverVersion }) })))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('плашка появляется, когда CDN догнал, без перезапуска', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    render(<UpdatePrompt />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()

    // Возврат на вкладку сразу — рано, сеть не дергаем.
    act(() => resume.fn())
    expect(fetch).toHaveBeenCalledTimes(1)

    serverVersion = '999.0.0'
    now.mockReturnValue(1_000_000 + RECHECK_MIN_MS)
    act(() => resume.fn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Обновление 999.0.0')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('UpdatePrompt — открыли пушем «вышла новая версия» (v6.11.1)', () => {
  beforeEach(() => {
    updateServiceWorker.mockClear()
    reg.update.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: '999.0.0' }) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
    delete document.documentElement.dataset.composer
  })

  it('без пуша — обычная плашка, сами не обновляемся', async () => {
    render(<UpdatePrompt />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Обновление 999.0.0')
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })

  it('?push=update — сразу проверяет и применяет новую версию без нажатия «Обновить»', async () => {
    window.history.replaceState(null, '', '/?push=update')
    render(<UpdatePrompt />)
    expect(reg.update).toHaveBeenCalled()
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true))
  })

  it('посреди записи тренировки не перезагружаем — показываем плашку', async () => {
    window.history.replaceState(null, '', '/?push=update')
    document.documentElement.dataset.composer = '1'
    render(<UpdatePrompt />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })
})

describe('shouldSurfaceWaiting (v6.15.0)', () => {
  const base = { hasWaiting: true, shown: false, snoozedAt: 0, quiet: false }
  it('ждущая версия без плашки — показать', () => {
    expect(shouldSurfaceWaiting(base)).toBe(true)
  })
  it('нет ждущей, плашка уже видна, отложили «Позже», сверка сказала «та же версия» — не трогаем', () => {
    expect(shouldSurfaceWaiting({ ...base, hasWaiting: false })).toBe(false)
    expect(shouldSurfaceWaiting({ ...base, shown: true })).toBe(false)
    expect(shouldSurfaceWaiting({ ...base, snoozedAt: 123 })).toBe(false)
    expect(shouldSurfaceWaiting({ ...base, quiet: true })).toBe(false)
  })
})

describe('UpdatePrompt — версия скачалась, пока приложение было свернуто (v6.15.0)', () => {
  let swTarget
  beforeEach(() => {
    swState.initial = false
    updateServiceWorker.mockClear()
    reg.update.mockClear()
    swTarget = new EventTarget()
    Object.defineProperty(navigator, 'serviceWorker', { value: swTarget, configurable: true })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: '999.0.0' }) })))
  })
  afterEach(() => {
    swState.initial = true
    vi.unstubAllGlobals()
    delete navigator.serviceWorker
  })

  it('возврат в приложение — плашка, хотя workbox событие не прислал', async () => {
    render(<UpdatePrompt />)
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => resume.fn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Обновление 999.0.0')
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })

  it('нажали пуш при открытом приложении — новая версия применяется сама', async () => {
    render(<UpdatePrompt />)
    act(() => {
      const e = new Event('message')
      e.data = { type: 'push-open', url: 'https://x/kachalka-app/?push=update' }
      swTarget.dispatchEvent(e)
    })
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true))
  })
})
