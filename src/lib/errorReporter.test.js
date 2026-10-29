import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initErrorReporter, captureError, resetErrorReporter } from './errorReporter.js'

const DSN = 'https://abc123@o1.ingest.de.sentry.io/4500'

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
  it('без DSN — пустышка, подписок нет', () => {
    const win = makeWin()
    expect(initErrorReporter({ dsn: '', release: '1.0.0', win })).toBe(false)
    expect(win.handlers).toEqual({})
    expect(() => captureError(new Error('x'))).not.toThrow()
  })

  it('ошибка уходит конвертом на приемник без секретов из адреса', () => {
    const win = makeWin()
    const fetchFn = vi.fn().mockResolvedValue({})
    initErrorReporter({ dsn: DSN, release: '1.7.2', win, fetchFn, now: () => 1_700_000_000_000 })
    win.handlers.error({ error: new TypeError('x is undefined') })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://o1.ingest.de.sentry.io/api/4500/envelope/?sentry_key=abc123&sentry_version=7')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toMatch(/^text\/plain/)
    expect(init.body).not.toContain('SECRET')
    const event = JSON.parse(init.body.split('\n')[2])
    expect(event.environment).toBe('production')
    expect(event.request.url).toBe('https://x.ru/app/')
    expect(event.user.id).toBe(win.store.gym_app_diag_id)
  })

  it('бета определяется по версии', () => {
    const win = makeWin()
    const fetchFn = vi.fn().mockResolvedValue({})
    initErrorReporter({ dsn: DSN, release: '1.7.2-beta.5', win, fetchFn })
    captureError(new Error('boom'), { source: 'react', handled: true })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body.split('\n')[2]).environment).toBe('beta')
  })

  it('unhandledrejection, офлайн, шум и повтор не отправляются / дедуплицируются', () => {
    const win = makeWin()
    const fetchFn = vi.fn().mockResolvedValue({})
    initErrorReporter({ dsn: DSN, release: '1.7.2', win, fetchFn })
    win.handlers.unhandledrejection({ reason: new Error('async boom') })
    win.handlers.unhandledrejection({ reason: new Error('async boom') })
    win.handlers.error({ error: new TypeError('Failed to fetch') })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const off = makeWin({ online: false })
    const fetchOff = vi.fn()
    resetErrorReporter()
    initErrorReporter({ dsn: DSN, release: '1.7.2', win: off, fetchFn: fetchOff })
    captureError(new Error('нет сети'))
    expect(fetchOff).not.toHaveBeenCalled()
  })

  it('сбой отправки и недоступный localStorage не роняют приложение', () => {
    const win = makeWin()
    win.localStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    const fetchFn = vi.fn().mockRejectedValue(new Error('down'))
    initErrorReporter({ dsn: DSN, release: '1.7.2', win, fetchFn })
    expect(() => captureError(new Error('x'))).not.toThrow()
    const event = JSON.parse(fetchFn.mock.calls[0][1].body.split('\n')[2])
    expect(event.user).toBeUndefined()
  })

  it('повторная инициализация не вешает второй обработчик', () => {
    const win = makeWin()
    const add = vi.spyOn(win, 'addEventListener')
    initErrorReporter({ dsn: DSN, release: '1.7.2', win, fetchFn: vi.fn() })
    initErrorReporter({ dsn: DSN, release: '1.7.2', win, fetchFn: vi.fn() })
    expect(add).toHaveBeenCalledTimes(2)
  })
})
