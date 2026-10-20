// Видео в обращении — настоящая загрузка через XMLHttpRequest (lib/feedbackApi.js xhrUpload;
// покрытие тестами 20.10.2026: раньше в тестах ее всегда подменяли). Прогресс по байтам,
// JWT и свой путь, 413 → «видео больше 50 МБ», обрыв сети, простой дольше UPLOAD_STALL_MS →
// «загрузка зависла» и abort, без сессии — до запроса; уже загруженное при ошибке убирается.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), hasSession: vi.fn(), upload: vi.fn(), remove: vi.fn(), getSession: vi.fn() }))
vi.mock('../db/feedbackReplies.js', () => ({ cacheFeedbackReplies: vi.fn() }))
vi.mock('../db/supabase.js', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  },
  hasSession: mocks.hasSession,
}))
const { attachFeedbackScreenshots, FeedbackError, UPLOAD_STALL_MS } = await import('./feedbackApi.js')

let xhrs
class FakeXHR {
  constructor() { this.headers = {}; this.upload = {}; this.aborted = false; xhrs.push(this) }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(k, v) { this.headers[k] = v }
  send(body) { this.body = body }
  abort() { this.aborted = true }
}
const mp4 = (size = 1000) => { const f = new File(['x'], 'v.mp4', { type: 'video/mp4' }); Object.defineProperty(f, 'size', { value: size }); return f }
const mov = () => { const f = new File(['x'], 'v.mov', { type: 'video/quicktime' }); Object.defineProperty(f, 'size', { value: 500 }); return f }
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  xhrs = []
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })))
  mocks.hasSession.mockResolvedValue(true)
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  mocks.remove.mockResolvedValue({})
  mocks.upload.mockResolvedValue({ error: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

describe('видео в обращении (XHR)', () => {
  it('JWT, своя папка, тип по расширению; прогресс по байтам; успех — путь уходит в Edge', async () => {
    const progress = []
    const p = attachFeedbackScreenshots('me', 'f1', [mov()], undefined, { onProgress: (x) => progress.push(x) })
    await flush()
    const x = xhrs[0]
    expect(x.method).toBe('POST')
    expect(x.url).toMatch(/\/storage\/v1\/object\/feedback\/me\/[0-9a-f-]{36}\.mov$/)
    expect(x.headers).toMatchObject({ authorization: 'Bearer tok', 'content-type': 'video/quicktime', 'x-upsert': 'false' })
    x.upload.onprogress({ loaded: 200 })
    x.status = 200
    x.onload()
    await p
    expect(progress).toContainEqual({ loaded: 200, total: 500 })
    expect(progress.at(-1)).toEqual({ loaded: 500, total: 500 })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toMatchObject({ action: 'attach', id: 'f1' })
    expect(body.screenshots[0]).toMatch(/\.mov$/)
  })

  it('413 — «видео слишком большое»; уже загруженное фото этой попытки убирается', async () => {
    const compress = vi.fn(async () => new Blob(['j']))
    const p = attachFeedbackScreenshots('me', 'f1', [new File(['p'], 'a.png', { type: 'image/png' }), mp4()], compress)
    await vi.waitFor(() => expect(xhrs).toHaveLength(1))
    xhrs[0].status = 413
    xhrs[0].onload()
    await expect(p).rejects.toMatchObject({ code: 'video_too_big' })
    expect(mocks.remove).toHaveBeenCalledWith([expect.stringMatching(/^me\/.+\.jpg$/)])
  })

  it('прочий отказ Storage — video_failed; обрыв сети — network', async () => {
    let p = attachFeedbackScreenshots('me', 'f1', [mp4()])
    await flush()
    xhrs[0].status = 500
    xhrs[0].onload()
    await expect(p).rejects.toMatchObject({ code: 'video_failed' })
    p = attachFeedbackScreenshots('me', 'f1', [mp4()])
    await flush()
    xhrs[1].onerror()
    await expect(p).rejects.toMatchObject({ code: 'network' })
  })

  it('простой дольше предела — abort и «загрузка зависла»; прогресс продлевает срок', async () => {
    vi.useFakeTimers()
    const p = attachFeedbackScreenshots('me', 'f1', [mp4()])
    const caught = p.catch((e) => e)
    await vi.waitFor(() => expect(xhrs).toHaveLength(1))
    vi.advanceTimersByTime(UPLOAD_STALL_MS - 1000)
    xhrs[0].upload.onprogress({ loaded: 10 }) // байты идут — срок заново
    vi.advanceTimersByTime(UPLOAD_STALL_MS - 1000)
    expect(xhrs[0].aborted).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(xhrs[0].aborted).toBe(true)
    const e = await caught
    expect(e).toBeInstanceOf(FeedbackError)
    expect(e.code).toBe('upload_stalled')
  })

  it('сессии в хранилище нет — no_session без запроса в Storage', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    await expect(attachFeedbackScreenshots('me', 'f1', [mp4()])).rejects.toMatchObject({ code: 'no_session' })
    expect(xhrs).toHaveLength(0)
  })
})
