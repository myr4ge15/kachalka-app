// @vitest-environment jsdom
// Плашка обновления — то, что не проверял UpdatePrompt.test.jsx (покрытие тестами
// 20.10.2026: ветки 65 %): «Обновить» перезагружает один раз по смене контроллера, «Позже»
// прячет и через 4 часа показывает снова, заголовок версии, сверка «та же версия» прячет,
// version.json недоступен — показываем (fail open), новая версия докачалась по statechange,
// возврат без сети и посреди записи тренировки — без ухода на сплэш, сдвиг контента.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import UpdatePrompt from './UpdatePrompt.jsx'

const h = vi.hoisted(() => ({ initial: true, reg: null, resume: null, online: null }))
const updateServiceWorker = vi.fn()
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: ({ onRegisteredSW }) => {
    const [needRefresh, setNeedRefresh] = useState(h.initial)
    onRegisteredSW('/sw.js', h.reg)
    return { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker }
  },
}))
const launch = vi.hoisted(() => ({ result: 'none' }))
vi.mock('../../lib/launchUpdate.js', () => ({ reloadForUpdatePush: vi.fn(async () => launch.result) }))
vi.mock('../../lib/appEvents.js', () => ({
  onResume: (fn) => { h.resume = fn; return () => {} },
  onOnline: (fn) => { h.online = fn; return () => {} },
}))

let server, swTarget
beforeEach(() => {
  h.initial = true
  h.reg = { waiting: {}, installing: null, update: vi.fn(() => Promise.resolve()) }
  server = { ok: true, json: async () => ({ version: '999.0.0', headline: 'Ответы на комментарии' }) }
  vi.stubGlobal('fetch', vi.fn(async () => server))
  swTarget = new EventTarget()
  Object.defineProperty(navigator, 'serviceWorker', { value: swTarget, configurable: true })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  launch.result = 'none'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  updateServiceWorker.mockClear()
  delete navigator.serviceWorker
  delete document.documentElement.dataset.composer
})

describe('UpdatePrompt — плашка', () => {
  it('версия и заголовок; пока видна — контент сдвинут; «Обновить» → SKIP_WAITING и одна перезагрузка', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, href: 'http://x/', reload }, configurable: true })
    render(<UpdatePrompt />)
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Обновление 999.0.0')
    expect(banner).toHaveTextContent('Ответы на комментарии')
    await waitFor(() => expect(document.documentElement.dataset.update).toBe('1')) // ставит эффект после отрисовки
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    swTarget.dispatchEvent(new Event('controllerchange'))
    swTarget.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('version.json недоступен — плашка без номера (fail open); та же версия — молча прячем', async () => {
    server = { ok: false }
    const { unmount } = render(<UpdatePrompt />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Новая версия')
    unmount()
    server = { ok: true, json: async () => ({ version: __APP_VERSION__ }) }
    render(<UpdatePrompt />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.documentElement.dataset.update).toBeUndefined()
  })

  it('«Позже» прячет; через 4 часа плановая проверка показывает снова', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<UpdatePrompt />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(30 * 60 * 1000) }) // проверка — рано
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(4 * 60 * 60 * 1000) })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('UpdatePrompt — новая версия докачивается', () => {
  it('ждущей нет: «снова онлайн» → проверка → установилась → плашка', async () => {
    h.initial = false
    h.reg.waiting = null
    const inst = new EventTarget()
    inst.state = 'installing'
    h.reg.installing = inst
    render(<UpdatePrompt />)
    await act(async () => { h.online() })
    expect(h.reg.update).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    inst.state = 'installed'
    h.reg.waiting = {}
    await act(async () => { inst.dispatchEvent(new Event('statechange')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('999.0.0')
  })

  it('офлайн при возврате — без сплэша и без запроса к серверу, только своя проверка', async () => {
    h.initial = false
    h.reg.waiting = null
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { reloadForUpdatePush } = await import('../../lib/launchUpdate.js')
    vi.mocked(reloadForUpdatePush).mockClear()
    render(<UpdatePrompt />)
    await act(async () => { h.resume() })
    expect(reloadForUpdatePush).not.toHaveBeenCalled()
    expect(h.reg.update).not.toHaveBeenCalled()
  })

  it('возврат посреди записи тренировки — флаг композера уходит в решение, плашка остается', async () => {
    h.initial = false
    document.documentElement.dataset.composer = '1'
    launch.result = 'composer'
    const { reloadForUpdatePush } = await import('../../lib/launchUpdate.js')
    render(<UpdatePrompt />)
    await act(async () => { h.resume() })
    expect(reloadForUpdatePush).toHaveBeenLastCalledWith(expect.objectContaining({ composerOpen: true, resume: true }))
    expect(await screen.findByRole('alert')).toBeInTheDocument() // ждущая версия есть — плашка
  })

  it('сообщение SW не про обновление — игнорируем', async () => {
    h.initial = false
    h.reg.waiting = null
    render(<UpdatePrompt />)
    const e = new Event('message')
    e.data = { type: 'push-open', url: 'https://x/?push=friend' }
    act(() => { swTarget.dispatchEvent(e) })
    expect(h.reg.update).not.toHaveBeenCalled()
  })
})
