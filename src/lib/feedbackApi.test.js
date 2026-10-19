import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), hasSession: vi.fn(), upload: vi.fn(), signed: vi.fn(), getSession: vi.fn(), from: vi.fn(),
}))
vi.mock('../db/feedbackReplies.js', () => ({ cacheFeedbackReplies: vi.fn() }))
vi.mock('../db/supabase.js', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
    storage: { from: mocks.from },
  },
  hasSession: mocks.hasSession,
}))

import {
  _clearMediaCache, ackMyFeedback, adminListFeedback, adminUpdateFeedback, feedbackMedia, feedbackShotUrl,
  attachFeedbackScreenshots, appendFeedback, listMyFeedback, myUnreadReplies, reopenFeedback, submitFeedback, FeedbackError,
} from './feedbackApi.js'
import { isVideoMedia } from './feedback.js'

const ok = (payload, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => payload })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasSession.mockResolvedValue(true)
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  mocks.from.mockReturnValue({ upload: mocks.upload, createSignedUrl: mocks.signed })
  vi.stubGlobal('fetch', vi.fn(() => ok({ ok: true, id: 'f1', delivered: true })))
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('submitFeedback', () => {
  it('без скриншота — сразу в Edge с токеном, текст обрезан', async () => {
    await expect(submitFeedback('me', { body: '  баг  ', context: { version: '1' } }))
      .resolves.toEqual({ id: 'f1', delivered: true })
    expect(mocks.upload).not.toHaveBeenCalled()
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/feedback$/)
    expect(opts.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body)).toEqual({ action: 'submit', body: 'баг', context: { version: '1' }, screenshot: null })
  })

  it('скриншот: сжатие, загрузка в свою папку, путь уходит в Edge', async () => {
    const compress = vi.fn(async () => new Blob(['x']))
    mocks.upload.mockResolvedValue({ error: null })
    await submitFeedback('me', { body: 'a', file: new Blob(['raw']), compress })
    expect(compress).toHaveBeenCalledWith(expect.any(Blob), 1280, 0.75)
    const [path, , opts] = mocks.upload.mock.calls[0]
    expect(path).toMatch(/^me\/[0-9a-f-]{36}\.jpg$/)
    expect(opts).toEqual({ upsert: false, contentType: 'image/jpeg' })
    expect(mocks.from).toHaveBeenCalledWith('feedback')
    expect(JSON.parse(fetch.mock.calls[0][1].body).screenshot).toBe(path)
  })

  it('сбой сжатия или загрузки — понятная ошибка, Edge не зовем', async () => {
    await expect(submitFeedback('me', { body: 'a', file: new Blob(['r']), compress: async () => { throw new Error('heic') } }))
      .rejects.toMatchObject({ code: 'shot_failed' })
    mocks.upload.mockResolvedValue({ error: { message: 'too big' } })
    await expect(submitFeedback('me', { body: 'a', file: new Blob(['r']), compress: async () => new Blob(['x']) }))
      .rejects.toMatchObject({ code: 'shot_failed' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('пустой текст, офлайн и чужая сессия отсекаются до сети', async () => {
    await expect(submitFeedback('me', { body: '  ' })).rejects.toMatchObject({ code: 'empty' })
    vi.stubGlobal('navigator', { onLine: false })
    await expect(submitFeedback('me', { body: 'a' })).rejects.toMatchObject({ code: 'offline' })
    vi.stubGlobal('navigator', { onLine: true })
    mocks.hasSession.mockResolvedValue(false)
    await expect(submitFeedback('me', { body: 'a' })).rejects.toMatchObject({ code: 'no_session' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ошибки Edge → коды: лимит, функция не задеплоена, сеть', async () => {
    fetch.mockImplementationOnce(() => ok({ error: 'rate_limited' }, 429))
    await expect(submitFeedback('me', { body: 'a' })).rejects.toMatchObject({ code: 'rate_limited' })
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error('html') } }))
    await expect(submitFeedback('me', { body: 'a' })).rejects.toMatchObject({ code: 'not_deployed' })
    fetch.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(submitFeedback('me', { body: 'a' })).rejects.toMatchObject({ code: 'network' })
  })

  it('записано, но Telegram не ответил — не ошибка для участника', async () => {
    fetch.mockImplementationOnce(() => ok({ ok: true, id: 'f2', delivered: false }))
    await expect(submitFeedback('me', { body: 'a' })).resolves.toEqual({ id: 'f2', delivered: false })
  })
})

describe('свои обращения', () => {
  it('список и непрочитанные ответы', async () => {
    const rows = [{ reply: 'да', replied_at: '2026-10-05T10:00:00Z', reply_seen_at: null }]
    mocks.rpc.mockResolvedValue({ data: rows })
    await expect(listMyFeedback('me')).resolves.toBe(rows)
    expect(mocks.rpc).toHaveBeenCalledWith('my_feedback', undefined)
    await expect(myUnreadReplies('me')).resolves.toBe(1)
  })
  it('нет функции на сервере — понятная ошибка; метка молча 0', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'x' } })
    await expect(listMyFeedback('me')).rejects.toMatchObject({ code: 'not_deployed' })
    await expect(myUnreadReplies('me')).resolves.toBe(0)
    mocks.hasSession.mockResolvedValue(false)
    await expect(myUnreadReplies('me')).resolves.toBe(0)
  })
  it('дополнения (v8.6.0) ложатся в свои обращения по порядку; нет RPC — список как есть', async () => {
    const rows = [{ id: 'f1', body: 'a' }, { id: 'f2', body: 'b' }]
    mocks.rpc.mockImplementation(async (name) => (name === 'my_feedback'
      ? { data: rows }
      : { data: [{ feedback_id: 'f1', n: 2, body: 'два', created_at: 't2' }, { feedback_id: 'f1', n: 1, body: 'раз', created_at: 't1' }] }))
    const got = await listMyFeedback('me')
    expect(got[0].additions.map((a) => a.body)).toEqual(['раз', 'два'])
    expect(got[1].additions).toBeUndefined()
    mocks.rpc.mockImplementation(async (name) => (name === 'my_feedback'
      ? { data: rows } : { error: { code: 'PGRST202', message: 'x' } }))
    await expect(listMyFeedback('me')).resolves.toBe(rows)
  })
  it('ack не бросает', async () => {
    mocks.rpc.mockRejectedValue(new Error('net'))
    await expect(ackMyFeedback()).resolves.toBeUndefined()
  })
})

describe('админка', () => {
  it('список с фильтром и обновление через Edge', async () => {
    mocks.rpc.mockResolvedValue({ data: [] })
    await adminListFeedback(true)
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_feedback', { p_open_only: true })
    fetch.mockImplementationOnce(() => ok({ ok: true, notified: true, pushed: 2 }))
    await expect(adminUpdateFeedback('f1', 'resolved', '  Исправлено  ')).resolves.toEqual({ notified: true, pushed: 2 })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'update', id: 'f1', status: 'resolved', reply: 'Исправлено' })
  })
  it('пустой ответ уходит как null; 403 — нет прав', async () => {
    fetch.mockImplementationOnce(() => ok({ ok: true, notified: false }))
    await adminUpdateFeedback('f1', 'in_progress', '   ')
    expect(JSON.parse(fetch.mock.calls[0][1].body).reply).toBeNull()
    fetch.mockImplementationOnce(() => ok({ error: 'forbidden' }, 403))
    await expect(adminUpdateFeedback('f1', 'new', '')).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('signed URL скриншота', async () => {
    mocks.signed.mockResolvedValue({ data: { signedUrl: 'https://x/s' } })
    await expect(feedbackShotUrl('me/a.jpg')).resolves.toBe('https://x/s')
    expect(mocks.signed).toHaveBeenCalledWith('me/a.jpg', 600)
  })
})

describe('Telegram: переоткрытие и картинки (v6.12.0)', () => {
  beforeEach(() => {
    _clearMediaCache()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x') })
  })

  it('reopen: комментарий обрезан, пустой — до сети не доходит; лимит — код', async () => {
    fetch.mockImplementationOnce(() => ok({ ok: true, delivered: true }))
    await expect(reopenFeedback('f1', '  не помогло  ')).resolves.toEqual({ delivered: true })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'reopen', id: 'f1', note: 'не помогло' })
    await expect(reopenFeedback('f1', '   ')).rejects.toMatchObject({ code: 'empty' })
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockImplementationOnce(() => ok({ error: 'reopen_limit' }, 429))
    await expect(reopenFeedback('f1', 'еще')).rejects.toMatchObject({ code: 'reopen_limit' })
  })

  it('append (v8.6.0): текст обрезан, пустой — до сети не доходит; лимит и закрытое — коды', async () => {
    fetch.mockImplementationOnce(() => ok({ ok: true, delivered: true }))
    await expect(appendFeedback('f1', '  и еще  ')).resolves.toEqual({ delivered: true })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'append', id: 'f1', note: 'и еще' })
    await expect(appendFeedback('f1', ' ')).rejects.toMatchObject({ code: 'empty' })
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockImplementationOnce(() => ok({ error: 'append_limit' }, 429))
    await expect(appendFeedback('f1', 'шестое')).rejects.toMatchObject({ code: 'append_limit' })
    fetch.mockImplementationOnce(() => ok({ error: 'not_open' }, 400))
    await expect(appendFeedback('f1', 'после решения')).rejects.toMatchObject({ code: 'not_open' })
  })

  it('media: байты → object URL, повтор из кэша; 404 — not_found и не кэшируется', async () => {
    const blobRes = { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer }
    fetch.mockImplementation(() => Promise.resolve(blobRes))
    await expect(feedbackMedia('f1', 'reply', 1)).resolves.toBe('blob:x')
    await feedbackMedia('f1', 'reply', 1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'media', id: 'f1', kind: 'reply', n: 1 })
    fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 404 }))
    await expect(feedbackMedia('f2', 'shot', 0)).rejects.toMatchObject({ code: 'not_found' })
    fetch.mockImplementation(() => Promise.resolve(blobRes))
    await expect(feedbackMedia('f2', 'shot', 0)).resolves.toBe('blob:x')
  })

  it('media офлайн — без сети', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(feedbackMedia('f3')).rejects.toMatchObject({ code: 'offline' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('несколько скриншотов', () => {
  it('отправляет все файлы в одном обращении через новый контракт', async () => {
    mocks.upload.mockResolvedValue({ error: null })
    const files = [new Blob(['a']), new Blob(['b'])]
    await submitFeedback('me', { body: 'баг', files, compress: async (f) => f })
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload.action).toBe('submit_screenshots')
    expect(payload.screenshots).toEqual(mocks.upload.mock.calls.map(([path]) => path))
    expect(new Set(payload.screenshots).size).toBe(2)
  })
  it('добавляет файлы к существующему обращению, проверяя сессию', async () => {
    mocks.upload.mockResolvedValue({ error: null })
    await attachFeedbackScreenshots('me', 'f1', [new Blob(['a'])], async (f) => f)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: 'attach', id: 'f1', screenshots: [expect.any(String)] })
    mocks.hasSession.mockResolvedValue(false)
    await expect(attachFeedbackScreenshots('other', 'f1', [new Blob()])).rejects.toMatchObject({ code: 'no_session' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('не создает обращение при сбое второго файла и убирает первый временный файл', async () => {
    const remove = vi.fn(async () => ({}))
    mocks.from.mockReturnValue({ upload: mocks.upload, remove })
    mocks.upload.mockResolvedValueOnce({}).mockResolvedValueOnce({ error: true })
    await expect(submitFeedback('me', { body: 'баг', files: [new Blob(), new Blob()], compress: async (f) => f }))
      .rejects.toMatchObject({ code: 'shot_failed' })
    expect(remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]])
    expect(fetch).not.toHaveBeenCalled()
  })
  it('видео (fb_1c5fab9c): без сжатия, путь .mp4/.mov, тип файла; больше 20 МБ — до загрузки', async () => {
    const uploadVideo = vi.fn(async () => {})
    const compress = vi.fn(async (f) => f)
    const mp4 = new File(['v'], 'clip.mp4', { type: 'video/mp4' })
    const mov = new File(['v'], 'IMG_1.MOV', { type: 'video/quicktime' })
    await submitFeedback('me', { body: 'баг', files: [mp4, mov], compress, uploadVideo })
    expect(compress).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled() // видео — своим загрузчиком с прогрессом
    const [[p1, b1, t1], [p2, , t2]] = uploadVideo.mock.calls
    expect(b1).toBe(mp4)
    expect([p1.slice(-4), t1, p2.slice(-4), t2]).toEqual(['.mp4', 'video/mp4', '.mov', 'video/quicktime'])
    uploadVideo.mockClear()
    const big = new File(['v'], 'big.mp4', { type: 'video/mp4' })
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 })
    await expect(submitFeedback('me', { body: 'баг', files: [big], uploadVideo })).rejects.toMatchObject({ code: 'video_too_big' })
    await expect(submitFeedback('me', { body: 'баг', files: [new File(['v'], 'a.webm', { type: 'video/webm' })], uploadVideo }))
      .rejects.toMatchObject({ code: 'video_format' })
    expect(uploadVideo).not.toHaveBeenCalled()
  })
  it('видео (fb_5ef64577): прогресс по байтам; сбой видео — «видео», а не «скриншот»; простой — свой код', async () => {
    mocks.upload.mockResolvedValue({ error: null })
    const shot = new File(['x'.repeat(100)], 'a.png', { type: 'image/png' })
    const clip = new File(['v'.repeat(1000)], 'clip.mp4', { type: 'video/mp4' })
    const steps = []
    const uploadVideo = vi.fn(async (path, blob, type, onBytes) => { onBytes(250); onBytes(1000) })
    await submitFeedback('me', { body: 'баг', files: [shot, clip], compress: async (f) => f, uploadVideo,
      onProgress: (p) => steps.push(p.loaded + '/' + p.total) })
    expect(steps).toEqual(['0/1100', '100/1100', '350/1100', '1100/1100', '1100/1100'])
    const fail = (e) => vi.fn(async () => { throw e })
    await expect(submitFeedback('me', { body: 'баг', files: [clip], uploadVideo: fail(new Error('x')) }))
      .rejects.toMatchObject({ code: 'video_failed' })
    await expect(submitFeedback('me', { body: 'баг', files: [clip], uploadVideo: fail(new FeedbackError('upload_stalled')) }))
      .rejects.toMatchObject({ code: 'upload_stalled' })
  })
  it('media: видео узнается по байтам и помечается (плитка рисует плеер)', async () => {
    _clearMediaCache()
    const mp4 = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypisom'), 0, 0, 0, 0])
    fetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => mp4.buffer }))
    const url = await feedbackMedia('v1', 'screenshots', 0)
    expect(isVideoMedia(url)).toBe(true)
  })
  it('отклоняет больше пяти файлов до загрузки', async () => {
    await expect(submitFeedback('me', { body: 'баг', files: Array(6).fill(new Blob()) })).rejects.toMatchObject({ code: 'shot_limit' })
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
