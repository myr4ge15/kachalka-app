// Предзагрузка вложений (20.10.2026): uploadAttachment грузит один файл сразу после выбора и
// возвращает путь; discardAttachments тихо убирает брошенное; attachUploadedScreenshots и
// submitFeedback({ paths }) шлют в Edge уже готовые пути, ничего не загружая заново.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ hasSession: vi.fn(), upload: vi.fn(), remove: vi.fn(), getSession: vi.fn() }))
vi.mock('../db/feedbackReplies.js', () => ({ cacheFeedbackReplies: vi.fn() }))
vi.mock('../db/supabase.js', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { getSession: mocks.getSession },
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  },
  hasSession: mocks.hasSession,
}))
const { uploadAttachment, discardAttachments, attachUploadedScreenshots, submitFeedback } = await import('./feedbackApi.js')

const png = () => new File(['p'], 'a.png', { type: 'image/png' })
const video = (name, type, size = 1000) => { const f = new File(['v'], name, { type }); Object.defineProperty(f, 'size', { value: size }); return f }
const body = () => JSON.parse(fetch.mock.calls[0][1].body)

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, id: 'f9', delivered: true }) })))
  mocks.hasSession.mockResolvedValue(true)
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({})
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('uploadAttachment', () => {
  it('картинка — сжатие в JPEG и путь в своей папке', async () => {
    const compress = vi.fn(async () => new Blob(['j'], { type: 'image/jpeg' }))
    const path = await uploadAttachment('me', png(), { compress })
    expect(path).toMatch(/^me\/[0-9a-f-]{36}\.jpg$/)
    expect(compress).toHaveBeenCalled()
    expect(mocks.upload).toHaveBeenCalledWith(path, expect.any(Blob), { upsert: false, contentType: 'image/jpeg' })
  })

  it('видео — как есть, с прогрессом по байтам; тип по расширению', async () => {
    const uploadVideo = vi.fn(async (p, f, type, onBytes) => { onBytes(400) })
    const onBytes = vi.fn()
    const path = await uploadAttachment('me', video('v.mov', 'video/quicktime'), { uploadVideo, onBytes })
    expect(path).toMatch(/\.mov$/)
    expect(uploadVideo).toHaveBeenCalledWith(path, expect.any(File), 'video/quicktime', expect.any(Function))
    expect(onBytes).toHaveBeenCalledWith(400)
    expect(await uploadAttachment('me', video('v.mp4', 'video/mp4'), { uploadVideo })).toMatch(/\.mp4$/)
  })

  it('без сети и без сессии — до загрузки; слишком большое видео — понятная причина', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(uploadAttachment('me', png())).rejects.toMatchObject({ code: 'offline' })
    vi.stubGlobal('navigator', { onLine: true })
    mocks.hasSession.mockResolvedValueOnce(false)
    await expect(uploadAttachment('me', png())).rejects.toMatchObject({ code: 'no_session' })
    await expect(uploadAttachment('me', video('big.mp4', 'video/mp4', 60 * 1024 * 1024))).rejects.toMatchObject({ code: 'video_too_big' })
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('сбой Storage — shot_failed для картинки, video_failed для видео', async () => {
    mocks.upload.mockResolvedValueOnce({ error: new Error('500') })
    await expect(uploadAttachment('me', png(), { compress: async (f) => f })).rejects.toMatchObject({ code: 'shot_failed' })
    const uploadVideo = vi.fn(async () => { throw new Error('boom') })
    await expect(uploadAttachment('me', video('v.mp4', 'video/mp4'), { uploadVideo })).rejects.toMatchObject({ code: 'video_failed' })
  })
})

describe('discardAttachments', () => {
  it('убирает только непустые пути; пусто — без запроса; сбой — тихо', async () => {
    await discardAttachments([null, ''])
    await discardAttachments(undefined)
    expect(mocks.remove).not.toHaveBeenCalled()
    await discardAttachments(['me/a.jpg', null])
    expect(mocks.remove).toHaveBeenCalledWith(['me/a.jpg'])
    mocks.remove.mockRejectedValueOnce(new Error('сеть'))
    await expect(discardAttachments(['me/b.jpg'])).resolves.toBeUndefined()
  })
})

describe('отправка готовых путей', () => {
  it('attachUploadedScreenshots — action attach с путями, без загрузки', async () => {
    await attachUploadedScreenshots('me', 'f1', ['me/a.jpg', 'me/b.mp4'])
    expect(body()).toMatchObject({ action: 'attach', id: 'f1', screenshots: ['me/a.jpg', 'me/b.mp4'] })
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('attachUploadedScreenshots — пусто, офлайн, чужая сессия отказывают', async () => {
    await expect(attachUploadedScreenshots('me', 'f1', [])).rejects.toMatchObject({ code: 'shot_failed' })
    mocks.hasSession.mockResolvedValueOnce(false)
    await expect(attachUploadedScreenshots('me', 'f1', ['me/a.jpg'])).rejects.toMatchObject({ code: 'no_session' })
    vi.stubGlobal('navigator', { onLine: false })
    await expect(attachUploadedScreenshots('me', 'f1', ['me/a.jpg'])).rejects.toMatchObject({ code: 'offline' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submitFeedback({ paths }) — новое обращение сразу с путями', async () => {
    await submitFeedback('me', { body: 'баг', context: {}, paths: ['me/a.jpg'] })
    expect(body()).toMatchObject({ screenshots: ['me/a.jpg'] })
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
