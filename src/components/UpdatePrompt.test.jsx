// @vitest-environment jsdom
// РЕВЬЮ-КОДА-2026-10-02: новый sw.js уже скачан, а version.json с CDN еще старый —
// плашка гасла до следующего запуска. Теперь check() перепроверяет версию.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import UpdatePrompt, { RECHECK_MIN_MS, shouldRecheckWaiting } from './UpdatePrompt.jsx'

const reg = { waiting: {}, update: vi.fn(() => Promise.resolve()) }
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: ({ onRegisteredSW }) => {
    const [needRefresh, setNeedRefresh] = useState(true)
    onRegisteredSW('/sw.js', reg)
    return { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker: vi.fn() }
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
