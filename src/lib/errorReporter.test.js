import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initErrorReporter, captureError, resetErrorReporter } from './errorReporter.js'

const TOKEN = btoa(JSON.stringify({ integrationId: '00000000-0000-4000-8000-000000000001', secret: '00000000-0000-4000-8000-000000000002' }))

function makeWin({ online = true } = {}) {
  const handlers = {}
  const store = {}
  return {
    handlers,
    store,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v } },
    navigator: { onLine: online },
    location: { href: 'https://x.ru/app/?a=1#reset=SECRET' },
    matchMedia: () => ({ matches: false }),
    addEventListener: (name, fn) => { handlers[name] = fn },
  }
}

beforeEach(() => resetErrorReporter())

describe('initErrorReporter', () => {
  it('без TOKEN — пустышка, подписок нет', () => {
    const win = makeWin()
    expect(initErrorReporter({ token: '', release: '1.0.0', win })).toBe(false)
    expect(win.handlers).toEqual({})
    expect(() => captureError(new Error('x'))).not.toThrow()
  })

  it('ошибка уходит в Hawk на приемник без секретов из адреса', () => {
    const win = makeWin()
    const fetchFn = vi.fn().mockResolvedValue({})
    initErrorReporter({ token: TOKEN, release: '1.7.2', win, fetchFn, now: () => 1_700_000_000_000 })
    win.handlers.error({ error: new TypeError('x is undefined') })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://00000000-0000-4000-8000-000000000001.k1.hawk.so')
    expect(init.method).toBe('POST')
    expect(init.mode).toBe('no-cors')
    expect(init.headers['Content-Type']).toMatch(/^text\/plain/)
    expect(init.body).not.toContain('SECRET')
    const event = JSON.parse(init.body).payload
    expect(event.context.environment).toBe('production')
    expect(event.context.url).toBe('https://x.ru/app/')
    expect(event.user.id).toBe(win.store.gym_app_diag_id)
  })

  it('бета определяется по версии', () => {
    const win = makeWin()
    const fetchFn = vi.fn().mockResolvedValue({})
    initErrorReporter({ token: TOKEN, release: '1.7.2-beta.5', win, fetchFn })
    captureError(new Error('boom'), { source: 'react', handled: true })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).payload.context.environment).toBe('beta')
  })

  it('unhandledrejection, офлайн, шум и повтор не отправляются / дедуплицируются', () => {
    const win = makeWin()
    const fetchFn = vi.fn().mockResolvedValue({})
    initErrorReporter({ token: TOKEN, release: '1.7.2', win, fetchFn })
    win.handlers.unhandledrejection({ reason: new Error('async boom') })
    win.handlers.unhandledrejection({ reason: new Error('async boom') })
    win.handlers.error({ error: new TypeError('Failed to fetch') })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const off = makeWin({ online: false })
    const fetchOff = vi.fn()
    resetErrorReporter()
    initErrorReporter({ token: TOKEN, release: '1.7.2', win: off, fetchFn: fetchOff })
    captureError(new Error('нет сети'))
    expect(fetchOff).not.toHaveBeenCalled()
  })

  it('сбой отправки и недоступный localStorage не роняют приложение', () => {
    const win = makeWin()
    win.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    const fetchFn = vi.fn().mockRejectedValue(new Error('down'))
    initErrorReporter({ token: TOKEN, release: '1.7.2', win, fetchFn })
    expect(() => captureError(new Error('x'))).not.toThrow()
    const event = JSON.parse(fetchFn.mock.calls[0][1].body).payload
    expect(event.user).toBeUndefined()
  })

  it('повторная инициализация не вешает второй обработчик', () => {
    const win = makeWin()
    const add = vi.spyOn(win, 'addEventListener')
    initErrorReporter({ token: TOKEN, release: '1.7.2', win, fetchFn: vi.fn() })
    initErrorReporter({ token: TOKEN, release: '1.7.2', win, fetchFn: vi.fn() })
    expect(add).toHaveBeenCalledTimes(2)
  })
})
