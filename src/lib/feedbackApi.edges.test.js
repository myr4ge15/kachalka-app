// lib/feedbackApi.js — края, которые не задевали другие тесты (покрытие 28.10.2026): настоящий XHR докачки
// больших видео (в feedbackApi.resumable.test.js HTTP подменен), пауза, пока приложение свернуто, выбор
// докачки для видео больше куска, id без crypto.randomUUID и гарды до сети (офлайн, нет сессии, длина).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), hasSession: vi.fn(), getSession: vi.fn(), signed: vi.fn() }))
vi.mock('../db/feedbackReplies.js', () => ({ cacheFeedbackReplies: vi.fn() }))
vi.mock('../db/supabase.js', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
    storage: { from: () => ({ createSignedUrl: mocks.signed, upload: vi.fn(), remove: vi.fn(async () => ({})) }) },
  },
  hasSession: mocks.hasSession,
}))
const api = await import('./feedbackApi.js')
const { resumableUpload, uploadAttachment, TUS_CHUNK, UPLOAD_STALL_MS } = api

let xhrs
class FakeXHR {
  constructor() { this.headers = {}; this.upload = {}; this.aborted = false; this.resHeaders = {}; xhrs.push(this) }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(k, v) { this.headers[k] = v }
  getResponseHeader(n) { return this.resHeaders[n] ?? null }
  send(body) { this.body = body }
  abort() { this.aborted = true }
  reply(status, headers = {}) { this.status = status; this.resHeaders = headers; this.onload() }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const next = async (n) => { for (let i = 0; i < 50 && xhrs.length < n; i++) await flush(); return xhrs[n - 1] }
const blob = (size) => ({ size, slice: (a, b) => ({ size: Math.min(b, size) - a, from: a }) })
const wait = vi.fn(async () => {})

beforeEach(() => {
  xhrs = []
  wait.mockClear()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('navigator', { onLine: true })
  mocks.hasSession.mockResolvedValue(true)
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

describe('докачка через настоящий XHR', () => {
  it('создание и кусок: TUS-заголовки, тело — кусок, прогресс по байтам от начала файла', async () => {
    const bytes = []
    const done = resumableUpload('me/v.mp4', blob(10), 'video/mp4', (b) => bytes.push(b), { wait })
    const post = await next(1)
    expect(post.method).toBe('POST')
    expect(post.url).toMatch(/\/storage\/v1\/upload\/resumable$/)
    expect(post.headers).toMatchObject({ authorization: 'Bearer tok', 'Tus-Resumable': '1.0.0', 'Upload-Length': '10' })
    post.reply(201, { Location: '/storage/v1/upload/resumable/abc' })
    const patch = await next(2)
    expect(patch.method).toBe('PATCH')
    expect(patch.url).toMatch(/\/upload\/resumable\/abc$/)
    expect(patch.headers).toMatchObject({ 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' })
    expect(patch.body).toEqual({ size: 10, from: 0 })
    patch.upload.onprogress({ loaded: 4 })
    patch.reply(204, { 'Upload-Offset': '10' })
    await done
    expect(bytes).toEqual([0, 4, 10])
  })

  it('кусок завис дольше предела — abort, сверка с сервером и продолжение с дошедшего места', async () => {
    vi.useFakeTimers()
    const done = resumableUpload('me/v.mp4', blob(10), 'video/mp4', null, { wait })
    ;(await next(1)).reply(201, { Location: '/u/1' })
    const stuck = await next(2)
    stuck.upload.onprogress({ loaded: 6 })
    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS)
    expect(stuck.aborted).toBe(true)
    const head = await next(3)
    expect(head.method).toBe('HEAD')
    head.reply(200, { 'Upload-Offset': '6' })
    const retry = await next(4)
    expect(retry.headers['Upload-Offset']).toBe('6')
    retry.reply(204, { 'Upload-Offset': '10' })
    await done
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('обрыв сети при свернутом приложении — ждет возврата на экран, без паузы по таймеру', async () => {
    const listeners = new Set()
    const doc = {
      visibilityState: 'visible',
      addEventListener: (_t, f) => listeners.add(f),
      removeEventListener: (_t, f) => listeners.delete(f),
    }
    vi.stubGlobal('document', doc)
    const done = resumableUpload('me/v.mp4', blob(10), 'video/mp4', null, { wait })
    ;(await next(1)).reply(201, { Location: '/u/1' })
    const cut = await next(2)
    doc.visibilityState = 'hidden'
    cut.onerror()
    await flush()
    expect(listeners.size).toBe(1)
    expect(xhrs).toHaveLength(2) // свернуто — не стучимся
    doc.visibilityState = 'visible'
    for (const f of [...listeners]) f()
    expect(listeners.size).toBe(0)
    ;(await next(3)).reply(200, { 'Upload-Offset': '0' })
    ;(await next(4)).reply(204, { 'Upload-Offset': '10' })
    await done
    expect(wait).not.toHaveBeenCalled()
  })
})

describe('выбор способа загрузки видео', () => {
  const mp4 = (size) => { const f = new File(['x'], 'v.mp4', { type: 'video/mp4' }); Object.defineProperty(f, 'size', { value: size }); return f }

  it('видео больше куска (6 МБ) — докачкой TUS; id файла — UUID v4 и без crypto.randomUUID', async () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (a) => real.getRandomValues(a) })
    const done = uploadAttachment('me', mp4(TUS_CHUNK + 1))
    const post = await next(1)
    expect(post.url).toMatch(/\/storage\/v1\/upload\/resumable$/)
    const name = atob(post.headers['Upload-Metadata'].match(/objectName (\S+?),/)[1])
    expect(name).toMatch(/^me\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp4$/)
    post.reply(201, { Location: '/u/1' })
    ;(await next(2)).reply(204, { 'Upload-Offset': String(TUS_CHUNK) })
    ;(await next(3)).reply(204, { 'Upload-Offset': String(TUS_CHUNK + 1) })
    await expect(done).resolves.toBe(name)
  })

  it('видео до куска — одним запросом в Storage', async () => {
    const done = uploadAttachment('me', mp4(TUS_CHUNK))
    const x = await next(1)
    expect(x.url).toMatch(/\/storage\/v1\/object\/feedback\/me\/[0-9a-f-]{36}\.mp4$/)
    x.reply(200)
    await expect(done).resolves.toMatch(/\.mp4$/)
  })
})

describe('гарды до сети', () => {
  it('RPC офлайн — offline без запроса; 42501 — forbidden; без сессии — no_session', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.adminListFeedback()).rejects.toMatchObject({ code: 'offline' })
    expect(mocks.rpc).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', { onLine: true })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } })
    await expect(api.adminListFeedback()).rejects.toMatchObject({ code: 'forbidden' })
    mocks.hasSession.mockResolvedValueOnce(false)
    await expect(api.listMyFeedback('me')).rejects.toMatchObject({ code: 'no_session' })
  })

  it('ответ длиннее 2000 — too_long до запроса; без токена — no_session до запроса', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.adminUpdateFeedback('f1', 'resolved', 'а'.repeat(2001))).rejects.toMatchObject({ code: 'too_long' })
    mocks.getSession.mockResolvedValueOnce({ data: { session: null } })
    await expect(api.adminUpdateFeedback('f1', 'resolved', 'ок')).rejects.toMatchObject({ code: 'no_session' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Edge ответил 401 — no_session; ссылка на скриншот не выдана — server_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(api.appendFeedback('f1', 'Еще деталь')).rejects.toMatchObject({ code: 'no_session' })
    mocks.signed.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
    await expect(api.feedbackShotUrl('me/a.jpg')).rejects.toMatchObject({ code: 'server_error' })
  })

  it('приложить без файлов или офлайн — отказ до загрузки', async () => {
    await expect(api.attachFeedbackScreenshots('me', 'f1', [])).rejects.toMatchObject({ code: 'shot_failed' })
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.attachFeedbackScreenshots('me', 'f1', [new Blob()])).rejects.toMatchObject({ code: 'offline' })
    expect(xhrs).toHaveLength(0)
  })
})
