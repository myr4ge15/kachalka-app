import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), hasSession: vi.fn(), upload: vi.fn(), signed: vi.fn(), getSession: vi.fn(), from: vi.fn(),
}))
vi.mock('../db/supabase.js', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
    storage: { from: mocks.from },
  },
  hasSession: mocks.hasSession,
}))

import {
  ackMyFeedback, adminListFeedback, adminUpdateFeedback, feedbackShotUrl, listMyFeedback,
  myUnreadReplies, submitFeedback,
} from './feedbackApi.js'

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
