import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { proxyHost, avatarCachePattern, withBackendCsp, authStorageKey } from './backendOrigin.js'

const PROXY = 'https://kachalka-api.someone.workers.dev'
const SUPA = 'https://lkrrbpbytinrdpfmhxep.supabase.co'
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf-8')
const csp = (html) => html.match(/Content-Security-Policy" content="([^"]*)"/)[1]
const directive = (html, name) => csp(html).split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '))

describe('proxyHost', () => {
  it('сам Supabase, пусто и мусор — не прокси', () => {
    expect(proxyHost(SUPA)).toBe(null)
    expect(proxyHost('https://e2e-offline.supabase.co')).toBe(null)
    expect(proxyHost('')).toBe(null)
    expect(proxyHost(undefined)).toBe(null)
    expect(proxyHost('не адрес')).toBe(null)
    expect(proxyHost('http://kachalka-api.someone.workers.dev')).toBe(null)
  })
  it('прокси — хост с портом, без пути', () => {
    expect(proxyHost(PROXY)).toBe('kachalka-api.someone.workers.dev')
    expect(proxyHost(PROXY + '/')).toBe('kachalka-api.someone.workers.dev')
    expect(proxyHost('https://api.example.ru:8443')).toBe('api.example.ru:8443')
  })
  it('похожий на supabase.co, но чужой домен — прокси', () => {
    expect(proxyHost('https://supabase.co.evil.ru')).toBe('supabase.co.evil.ru')
  })
})

describe('avatarCachePattern', () => {
  const path = '/storage/v1/object/public/avatars/u1/a.jpg?v=1'
  it('без прокси — прежний шаблон *.supabase.co', () => {
    const re = avatarCachePattern(SUPA)
    expect(re.test(SUPA + path)).toBe(true)
    expect(re.test(PROXY + path)).toBe(false)
  })
  it('с прокси — и прокси, и прямой Supabase; только с начала URL', () => {
    const re = avatarCachePattern(PROXY)
    expect(re.test(PROXY + path)).toBe(true)
    expect(re.test(SUPA + path)).toBe(true)
    expect(re.test('https://kachalka-apiXsomeone.workers.dev' + path)).toBe(false)
    expect(re.test('https://x.ru/?u=' + PROXY + path)).toBe(false)
    expect(re.test(PROXY + '/storage/v1/object/public/feedback/a.jpg')).toBe(false)
  })
})

describe('withBackendCsp (на настоящем index.html)', () => {
  it('без прокси html не меняется', () => {
    expect(withBackendCsp(indexHtml, SUPA)).toBe(indexHtml)
    expect(withBackendCsp(indexHtml, '')).toBe(indexHtml)
  })
  it('прокси разрешен в img-src и connect-src (https + wss), остальное как было', () => {
    const out = withBackendCsp(indexHtml, PROXY)
    const host = 'kachalka-api.someone.workers.dev'
    expect(directive(out, 'img-src')).toBe(directive(indexHtml, 'img-src') + ` https://${host}`)
    expect(directive(out, 'connect-src')).toBe(directive(indexHtml, 'connect-src') + ` https://${host} wss://${host}`)
    expect(directive(out, 'script-src')).toBe(directive(indexHtml, 'script-src'))
    expect(directive(out, 'connect-src')).toContain('https://*.supabase.co')
    expect(out.replace(csp(out), '')).toBe(indexHtml.replace(csp(indexHtml), ''))
  })
  it('нет мета-тега CSP при прокси — ошибка сборки, а не тихая поломка', () => {
    expect(() => withBackendCsp('<html></html>', PROXY)).toThrow(/CSP/)
    expect(withBackendCsp('<html></html>', SUPA)).toBe('<html></html>')
  })
})

describe('authStorageKey', () => {
  it('ref задан — ключ как у supabase-js для <ref>.supabase.co', () => {
    expect(authStorageKey('lkrrbpbytinrdpfmhxep')).toBe('sb-lkrrbpbytinrdpfmhxep-auth-token')
    expect(authStorageKey(' lkrrbpbytinrdpfmhxep ')).toBe('sb-lkrrbpbytinrdpfmhxep-auth-token')
  })
  it('не задан или мусор — умолчание supabase-js', () => {
    expect(authStorageKey(undefined)).toBe(null)
    expect(authStorageKey('')).toBe(null)
    expect(authStorageKey('a b')).toBe(null)
    expect(authStorageKey('https://x.supabase.co')).toBe(null)
  })
})
