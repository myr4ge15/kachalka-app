// lib/avatar.js — сжатие и загрузка (до v6.14.2 тестами покрыты только чистые
// fitDimensions/isHeic). DOM-части (Image/canvas/object URL) — заглушки: проверяем
// оркестрацию — размеры, отзыв URL, ветку HEIC, путь в Storage, ?v= и RPC.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upload = vi.fn()
const getPublicUrl = vi.fn()
const rpc = vi.fn()
vi.mock('../db/supabase.js', () => ({
  supabase: {
    storage: { from: (bucket) => ({ upload: (...a) => upload(bucket, ...a), getPublicUrl: (...a) => getPublicUrl(bucket, ...a) }) },
    rpc: (...a) => rpc(...a),
  },
}))
const heic2any = vi.fn()
vi.mock('heic2any', () => ({ default: (...a) => heic2any(...a) }))

const { compressToJpeg, uploadMyAvatar } = await import('./avatar.js')

let imgSize, imgFails, canvas, revoked, loadedFiles
const jpegBlob = { size: 1234, type: 'image/jpeg' }
const file = (name = 'me.jpg', type = 'image/jpeg', bytes = [1, 2, 3]) => ({
  name, type, slice: () => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer }),
})

beforeEach(() => {
  imgSize = { naturalWidth: 1024, naturalHeight: 512 }
  imgFails = false
  revoked = []
  loadedFiles = []
  canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: vi.fn((cb, type, q) => cb(jpegBlob, type, q)),
  }
  vi.stubGlobal('URL', { createObjectURL: (f) => { loadedFiles.push(f); return 'blob:x' }, revokeObjectURL: (u) => revoked.push(u) })
  vi.stubGlobal('Image', class {
    set src(_v) {
      queueMicrotask(() => {
        if (imgFails) this.onerror?.()
        else { Object.assign(this, imgSize); this.onload?.() }
      })
    }
  })
  vi.stubGlobal('document', { createElement: (t) => (t === 'canvas' ? canvas : null) })
  vi.stubGlobal('File', class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type } })
  upload.mockReset().mockResolvedValue({ error: null })
  getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: 'https://cdn/avatars/u1/avatar.jpg' } })
  rpc.mockReset().mockResolvedValue({ error: null })
  heic2any.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('compressToJpeg', () => {
  it('вписывает в 256 по большей стороне, JPEG 0.8, object URL отзывается', async () => {
    const blob = await compressToJpeg(file())
    expect(blob).toBe(jpegBlob)
    expect([canvas.width, canvas.height]).toEqual([256, 128])
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8)
    expect(revoked).toEqual(['blob:x'])
  })

  it('битая картинка — понятная ошибка и URL все равно отзывается', async () => {
    imgFails = true
    await expect(compressToJpeg(file())).rejects.toThrow('Не удалось прочитать изображение')
    expect(revoked).toEqual(['blob:x'])
  })

  it('canvas не отдал blob — «Сжатие не удалось»', async () => {
    canvas.toBlob = (cb) => cb(null)
    await expect(compressToJpeg(file())).rejects.toThrow('Сжатие не удалось')
  })

  it('HEIC сначала конвертируется в JPEG (массив из heic2any — берем первый)', async () => {
    heic2any.mockResolvedValue([{ converted: true }])
    await compressToJpeg(file('IMG_1.HEIC', ''))
    expect(heic2any).toHaveBeenCalledWith(expect.objectContaining({ toType: 'image/jpeg', quality: 0.9 }))
    expect(loadedFiles[0]).toMatchObject({ name: 'avatar.jpg', type: 'image/jpeg', parts: [{ converted: true }] })
  })

  it('HEIC-воркер завис — по таймауту понятная ошибка', async () => {
    vi.useFakeTimers()
    try {
      heic2any.mockReturnValue(new Promise(() => {}))
      const p = compressToJpeg(file('a.heic', 'image/heic'))
      const check = expect(p).rejects.toThrow(/HEIC/)
      await vi.advanceTimersByTimeAsync(20000)
      await check
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('uploadMyAvatar', () => {
  it('upsert в avatars/<id>/avatar.jpg → URL с ?v= → RPC set_my_avatar_url', async () => {
    const url = await uploadMyAvatar('u1', file())
    expect(upload).toHaveBeenCalledWith('avatars', 'u1/avatar.jpg', jpegBlob, { upsert: true, contentType: 'image/jpeg' })
    expect(url).toMatch(/^https:\/\/cdn\/avatars\/u1\/avatar\.jpg\?v=\d+$/)
    expect(rpc).toHaveBeenCalledWith('set_my_avatar_url', { p_url: url })
  })

  it('ошибка загрузки — бросает, RPC не зовется; ошибка RPC — бросает', async () => {
    upload.mockResolvedValueOnce({ error: new Error('413') })
    await expect(uploadMyAvatar('u1', file())).rejects.toThrow('413')
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValueOnce({ error: new Error('RLS') })
    await expect(uploadMyAvatar('u1', file())).rejects.toThrow('RLS')
  })
})
