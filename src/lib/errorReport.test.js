import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseDsn, envelopeUrl, withReportCsp, scrubText, scrubUrl, parseStack,
  shouldIgnore, buildEvent, toEnvelope, createLimiter,
} from './errorReport.js'

const DSN = 'https://abc123@o1.ingest.de.sentry.io/4500'
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf-8')
const csp = (html) => html.match(/Content-Security-Policy" content="([^"]*)"/)[1]
const connectSrc = (html) => csp(html).match(/connect-src ([^;]*)/)[1]

describe('parseDsn / envelopeUrl', () => {
  it('разбирает https DSN', () => {
    expect(parseDsn(DSN)).toEqual({ key: 'abc123', host: 'o1.ingest.de.sentry.io', project: '4500' })
    expect(envelopeUrl(parseDsn(DSN))).toBe('https://o1.ingest.de.sentry.io/api/4500/envelope/?sentry_key=abc123&sentry_version=7')
  })
  it('пусто, не https, без ключа или проекта — null', () => {
    for (const bad of [undefined, '', 'мусор', 'http://k@h/1', 'https://h/1', 'https://k@h/', 'https://k@h/abc']) {
      expect(parseDsn(bad)).toBe(null)
    }
  })
})

describe('withReportCsp (на настоящем index.html)', () => {
  it('без DSN html не меняется', () => {
    expect(withReportCsp(indexHtml, '')).toBe(indexHtml)
    expect(withReportCsp(indexHtml, 'мусор')).toBe(indexHtml)
  })
  it('с DSN хост добавлен только в connect-src', () => {
    const out = withReportCsp(indexHtml, DSN)
    expect(connectSrc(out)).toBe(connectSrc(indexHtml) + ' https://o1.ingest.de.sentry.io')
    expect(csp(out).match(/script-src [^;]*/)[0]).toBe(csp(indexHtml).match(/script-src [^;]*/)[0])
  })
  it('нет CSP при заданном DSN — ошибка сборки', () => {
    expect(() => withReportCsp('<html></html>', DSN)).toThrow(/CSP/)
    expect(withReportCsp('<html></html>', '')).toBe('<html></html>')
  })
})

describe('scrubText / scrubUrl', () => {
  it('вырезает JWT, email, секреты из адреса и длинные токены', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpM'
    expect(scrubText(`bad ${jwt} for a.b@mail.ru`)).toBe('bad [jwt] for [email]')
    expect(scrubText('fail at #reset=SECRETVALUE&x=1')).toBe('fail at #reset=[x]&x=1')
    expect(scrubText('key ' + 'A1b2'.repeat(10))).toBe('key [token]')
  })
  it('обрезает длинный текст', () => {
    expect(scrubText('я'.repeat(1000)).length).toBe(300)
  })
  it('адрес без query и hash', () => {
    expect(scrubUrl('https://x.ru/kachalka-app/?a=1#reset=SECRET')).toBe('https://x.ru/kachalka-app/')
    expect(scrubUrl('не адрес?q=1#h')).toBe('не адрес')
  })
})

describe('parseStack', () => {
  it('V8: кадры от старого вызова к новому, адреса чистые', () => {
    const stack = [
      'TypeError: x is undefined',
      '    at inner (https://x.ru/assets/a.js?v=1:10:5)',
      '    at https://x.ru/assets/b.js:3:7',
    ].join('\n')
    expect(parseStack(stack)).toEqual([
      { function: '?', filename: 'https://x.ru/assets/b.js', abs_path: 'https://x.ru/assets/b.js', lineno: 3, colno: 7 },
      { function: 'inner', filename: 'https://x.ru/assets/a.js', abs_path: 'https://x.ru/assets/a.js', lineno: 10, colno: 5 },
    ])
  })
  it('Safari/Firefox: имя@адрес:строка:колонка', () => {
    expect(parseStack('go@https://x.ru/a.js:4:9')).toEqual([
      { function: 'go', filename: 'https://x.ru/a.js', abs_path: 'https://x.ru/a.js', lineno: 4, colno: 9 },
    ])
  })
  it('пусто и мусор — пустой список', () => {
    expect(parseStack('')).toEqual([])
    expect(parseStack(undefined)).toEqual([])
  })
})

describe('shouldIgnore', () => {
  it('офлайн-сеть, отмена запроса и ResizeObserver — шум', () => {
    expect(shouldIgnore('TypeError', 'Failed to fetch')).toBe(true)
    expect(shouldIgnore('TypeError', 'Load failed')).toBe(true)
    expect(shouldIgnore('AbortError', 'x')).toBe(true)
    expect(shouldIgnore('Error', 'ResizeObserver loop completed')).toBe(true)
  })
  it('верхний кадр из расширения браузера — шум', () => {
    const frames = [{ filename: 'chrome-extension://abc/x.js' }]
    expect(shouldIgnore('Error', 'boom', frames)).toBe(true)
  })
  it('обычная ошибка кода — не шум', () => {
    expect(shouldIgnore('TypeError', 'x is undefined', [{ filename: 'https://x.ru/a.js' }])).toBe(false)
  })
})

describe('buildEvent / toEnvelope', () => {
  const ctx = {
    eventId: 'e'.repeat(32), timestamp: 1700000000, release: '1.7.2', environment: 'production',
    source: 'onerror', handled: false, deviceId: 'dev1', url: 'https://x.ru/app/?t=1#reset=SECRET',
    tags: { standalone: 'true' },
  }
  it('собирает событие без query/hash и с вычищенным текстом', () => {
    const err = new TypeError('сломалось для a@b.ru')
    const ev = buildEvent(err, ctx)
    expect(ev.release).toBe('1.7.2')
    expect(ev.request.url).toBe('https://x.ru/app/')
    expect(ev.user).toEqual({ id: 'dev1' })
    expect(ev.exception.values[0]).toMatchObject({
      type: 'TypeError', value: 'сломалось для [email]', mechanism: { type: 'onerror', handled: false },
    })
    expect(JSON.stringify(ev)).not.toContain('SECRET')
  })
  it('не-Error (строка, объект) не падает', () => {
    expect(buildEvent('просто строка', ctx).exception.values[0]).toMatchObject({ type: 'NonError', value: 'просто строка' })
    expect(buildEvent({ a: 1 }, ctx).exception.values[0].value).toBe('{"a":1}')
  })
  it('шум → null', () => {
    expect(buildEvent(new TypeError('Failed to fetch'), ctx)).toBe(null)
  })
  it('конверт — три строки JSON', () => {
    const ev = buildEvent(new Error('x'), ctx)
    const lines = toEnvelope(ev, '2026-10-29T00:00:00.000Z').split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0])).toEqual({ event_id: ctx.eventId, sent_at: '2026-10-29T00:00:00.000Z' })
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' })
    expect(JSON.parse(lines[2]).event_id).toBe(ctx.eventId)
  })
})

describe('createLimiter', () => {
  it('одинаковое не чаще раза в окно, потом снова можно', () => {
    const allow = createLimiter({ max: 10, dedupeMs: 1000 })
    expect(allow('a', 0)).toBe(true)
    expect(allow('a', 500)).toBe(false)
    expect(allow('a', 1500)).toBe(true)
  })
  it('потолок за сессию', () => {
    const allow = createLimiter({ max: 2, dedupeMs: 0 })
    expect(allow('a', 0)).toBe(true)
    expect(allow('b', 0)).toBe(true)
    expect(allow('c', 0)).toBe(false)
  })
})
