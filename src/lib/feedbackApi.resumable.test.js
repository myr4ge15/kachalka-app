// Докачка больших видео (23.10.2026, «медиа начинает грузиться заново»): TUS-загрузка кусками по 6 МБ,
// после обрыва — сверка с сервером (HEAD → Upload-Offset) и продолжение с того места, а не с нуля.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../db/feedbackReplies.js', () => ({ cacheFeedbackReplies: vi.fn() }))
vi.mock('../db/supabase.js', () => ({
  supabase: { rpc: vi.fn(), auth: { getSession: mocks.getSession }, storage: { from: () => ({}) } },
  hasSession: vi.fn(async () => true),
}))
const { resumableUpload, TUS_CHUNK, FeedbackError } = await import('./feedbackApi.js')

const blob = (size) => ({ size, slice: (a, b) => ({ size: Math.min(b, size) - a, from: a }) })
const res = (status, headers = {}) => ({ status, header: (n) => headers[n] ?? null })
const wait = vi.fn(async () => {})

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  wait.mockClear()
})

describe('resumableUpload', () => {
  it('создает загрузку и шлет куски по 6 МБ; прогресс — по байтам от начала файла', async () => {
    const size = TUS_CHUNK * 2 + 100
    const calls = []
    const request = vi.fn(async (method, url, o) => {
      calls.push([method, o.headers?.['Upload-Offset'] ?? null, o.body?.size ?? null])
      if (method === 'POST') return res(201, { Location: 'http://x/storage/v1/upload/resumable/abc' })
      return res(204, { 'Upload-Offset': String(Number(o.headers['Upload-Offset']) + o.body.size) })
    })
    const bytes = []
    await resumableUpload('me/v.mp4', blob(size), 'video/mp4', (b) => bytes.push(b), { request, wait })
    expect(calls).toEqual([['POST', null, null], ['PATCH', '0', TUS_CHUNK], ['PATCH', String(TUS_CHUNK), TUS_CHUNK],
      ['PATCH', String(TUS_CHUNK * 2), 100]])
    expect(bytes.at(-1)).toBe(size)
    const post = request.mock.calls[0][2].headers
    expect(post['Upload-Length']).toBe(String(size))
    expect(post.authorization).toBe('Bearer tok')
    expect(post['Upload-Metadata']).toContain(`objectName ${btoa('me/v.mp4')}`)
  })

  it('обрыв посреди куска — сверка с сервером и продолжение с дошедшего места, не с нуля', async () => {
    let patches = 0
    const request = vi.fn(async (method, url, o) => {
      if (method === 'POST') return res(201, { Location: '/storage/v1/upload/resumable/abc' })
      if (method === 'HEAD') return res(200, { 'Upload-Offset': String(TUS_CHUNK) })
      patches += 1
      if (patches === 2) throw new FeedbackError('network') // второй кусок оборвался
      return res(204, { 'Upload-Offset': String(Number(o.headers['Upload-Offset']) + o.body.size) })
    })
    await resumableUpload('me/v.mp4', blob(TUS_CHUNK * 2), 'video/mp4', null, { request, wait })
    const offsets = request.mock.calls.filter(([m]) => m === 'PATCH').map(([, , o]) => o.headers['Upload-Offset'])
    expect(offsets).toEqual(['0', String(TUS_CHUNK), String(TUS_CHUNK)]) // повтор с 6 МБ, а не с 0
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('много обрывов подряд — ошибка наружу; 413 — «видео больше 50 МБ»; без сессии — до запроса', async () => {
    const dead = vi.fn(async (method) => (method === 'POST' ? res(201, { Location: '/u/1' })
      : method === 'HEAD' ? res(200, { 'Upload-Offset': '0' }) : Promise.reject(new FeedbackError('network'))))
    await expect(resumableUpload('me/v.mp4', blob(10), 'video/mp4', null, { request: dead, wait })).rejects.toMatchObject({ code: 'network' })
    const big = vi.fn(async () => res(413))
    await expect(resumableUpload('me/v.mp4', blob(10), 'video/mp4', null, { request: big, wait })).rejects.toMatchObject({ code: 'video_too_big' })
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    const never = vi.fn()
    await expect(resumableUpload('me/v.mp4', blob(10), 'video/mp4', null, { request: never, wait })).rejects.toMatchObject({ code: 'no_session' })
    expect(never).not.toHaveBeenCalled()
  })

  it('ответ 409 (сервер ждет другой кусок) — сверка и повтор; 4xx — ошибка без повторов', async () => {
    let first = true
    const request = vi.fn(async (method, url, o) => {
      if (method === 'POST') return res(201, { Location: '/u/1' })
      if (method === 'HEAD') return res(200, { 'Upload-Offset': '4' })
      if (first) { first = false; return res(409) }
      return res(204, { 'Upload-Offset': String(Number(o.headers['Upload-Offset']) + o.body.size) })
    })
    await resumableUpload('me/v.mp4', blob(10), 'video/mp4', null, { request, wait })
    expect(request.mock.calls.filter(([m]) => m === 'PATCH').map(([, , o]) => o.headers['Upload-Offset'])).toEqual(['0', '4'])
    const bad = vi.fn(async (method) => (method === 'POST' ? res(201, { Location: '/u/1' }) : res(400)))
    await expect(resumableUpload('me/v.mp4', blob(10), 'video/mp4', null, { request: bad, wait })).rejects.toMatchObject({ code: 'video_failed' })
  })
})
