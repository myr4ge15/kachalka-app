import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseHawkToken, collectorUrl, withReportCsp, scrubText, scrubUrl, parseStack,
  shouldIgnore, buildEvent, toHawkMessage, createLimiter,
} from './errorReport.js'

const TOKEN = btoa(JSON.stringify({ integrationId: '00000000-0000-4000-8000-000000000001', secret: '00000000-0000-4000-8000-000000000002' }))
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf-8')
const csp = (html) => html.match(/Content-Security-Policy" content="([^"]*)"/)[1]
const connectSrc = (html) => csp(html).match(/connect-src ([^;]*)/)[1]

describe('parseHawkToken / collectorUrl', () => {
  it('разбирает https TOKEN', () => {
    expect(parseHawkToken(TOKEN)).toEqual({ host: '00000000-0000-4000-8000-000000000001.k1.hawk.so' })
    expect(collectorUrl(parseHawkToken(TOKEN))).toBe('https://00000000-0000-4000-8000-000000000001.k1.hawk.so')
  })
  it('пусто, не https, без ключа или проекта — null', () => {
    for (const bad of [undefined, '', 'мусор', 'http://k@h/1', 'https://h/1', 'https://k@h/', 'https://k@h/abc', btoa('{}'), btoa(JSON.stringify({ integrationId: 'host/path', secret: 'x' }))]) {
      expect(parseHawkToken(bad)).toBe(null)
    }
  })
})

describe('withReportCsp (на настоящем index.html)', () => {
  it('без TOKEN html не меняется', () => {
    expect(withReportCsp(indexHtml, '')).toBe(indexHtml)
    expect(withReportCsp(indexHtml, 'мусор')).toBe(indexHtml)
  })
  it('с TOKEN хост добавлен только в connect-src', () => {
    const out = withReportCsp(indexHtml, TOKEN)
    expect(connectSrc(out)).toBe(connectSrc(indexHtml) + ' https://00000000-0000-4000-8000-000000000001.k1.hawk.so')
    expect(csp(out).match(/script-src [^;]*/)[0]).toBe(csp(indexHtml).match(/script-src [^;]*/)[0])
  })
  it('нет CSP при заданном TOKEN — ошибка сборки', () => {
    expect(() => withReportCsp('<html></html>', TOKEN)).toThrow(/CSP/)
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

describe('buildEvent / toHawkMessage', () => {
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
  it('сообщение Hawk: очищенные поля и кадры от нового к старому', () => {
    const err = new TypeError('bad a@b.ru')
    err.stack = 'TypeError: bad\n at inner (https://x.ru/a.js?token=SECRET:10:2)\n at outer (https://x.ru/b.js:20:4)'
    const msg = toHawkMessage(buildEvent(err, ctx), TOKEN)
    expect(msg.token).toBe(TOKEN)
    expect(msg.catcherType).toBe('errors/javascript')
    expect(msg.payload).toMatchObject({
      title: 'bad [email]', type: 'TypeError', release: ctx.release,
      user: { id: 'dev1' }, context: { environment: 'production', url: 'https://x.ru/app/', source: 'onerror', handled: false },
    })
    expect(msg.payload.backtrace).toEqual([
      { file: 'https://x.ru/a.js', line: 10, column: 2, function: 'inner' },
      { file: 'https://x.ru/b.js', line: 20, column: 4, function: 'outer' },
    ])
    expect(JSON.stringify(msg)).not.toContain('SECRET')
    expect(toHawkMessage(buildEvent('plain', {}), TOKEN).payload.backtrace).toEqual([])
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
