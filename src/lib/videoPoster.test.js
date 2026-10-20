// Кадр видео для миниатюры (20.10.2026): невидимый <video> → перемотка → canvas → JPEG.
// DOM подменяем: события видео дергаем руками.
import { describe, expect, it, vi } from 'vitest'
import { videoPoster } from './videoPoster.js'

function fakeDom({ w = 1080, h = 1920, duration = 5, draw = vi.fn() } = {}) {
  const handlers = {}
  const video = {
    addEventListener: (e, fn) => { handlers[e] = fn },
    removeAttribute: vi.fn(), load: vi.fn(),
    videoWidth: w, videoHeight: h, duration, currentTime: 0,
  }
  const canvas = { getContext: () => ({ drawImage: draw }), toDataURL: vi.fn(() => 'data:image/jpeg;base64,AA') }
  const doc = { createElement: (t) => (t === 'video' ? video : canvas) }
  const url = { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() }
  return { doc, url, video, canvas, handlers, draw }
}

describe('videoPoster', () => {
  it('кадр на 0,1 с, уменьшенный до maxSide, JPEG; ссылка освобождается', async () => {
    const d = fakeDom()
    const p = videoPoster(new Blob(['v']), { doc: d.doc, url: d.url })
    expect(d.video.src).toBe('blob:v')
    expect(d.video.muted).toBe(true)
    d.handlers.loadeddata()
    expect(d.video.currentTime).toBe(0.1)
    d.handlers.seeked()
    await expect(p).resolves.toBe('data:image/jpeg;base64,AA')
    expect(d.canvas.width).toBe(203)
    expect(d.canvas.height).toBe(360)
    expect(d.canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7)
    expect(d.url.revokeObjectURL).toHaveBeenCalledWith('blob:v')
    expect(d.video.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('короткое видео — кадр до конца, а не за ним', async () => {
    const d = fakeDom({ duration: 0.08 })
    videoPoster(new Blob(['v']), { doc: d.doc, url: d.url })
    d.handlers.loadeddata()
    expect(d.video.currentTime).toBeCloseTo(0.03)
  })

  it('ошибка декодера, нет размеров, сбой canvas — null', async () => {
    let d = fakeDom()
    let p = videoPoster(new Blob(['v']), { doc: d.doc, url: d.url })
    d.handlers.error()
    await expect(p).resolves.toBeNull()

    d = fakeDom({ w: 0 })
    p = videoPoster(new Blob(['v']), { doc: d.doc, url: d.url })
    d.handlers.seeked()
    await expect(p).resolves.toBeNull()

    d = fakeDom({ draw: vi.fn(() => { throw new Error('tainted') }) })
    p = videoPoster(new Blob(['v']), { doc: d.doc, url: d.url })
    d.handlers.seeked()
    await expect(p).resolves.toBeNull()
  })

  it('кадр не пришел за timeout — null; второе событие после ответа ничего не меняет', async () => {
    vi.useFakeTimers()
    const d = fakeDom()
    const p = videoPoster(new Blob(['v']), { doc: d.doc, url: d.url, timeout: 100 })
    vi.advanceTimersByTime(100)
    await expect(p).resolves.toBeNull()
    d.handlers.seeked()
    expect(d.url.revokeObjectURL).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('нет файла или DOM — сразу null', async () => {
    await expect(videoPoster(null)).resolves.toBeNull()
    await expect(videoPoster(new Blob(['v']), { doc: null })).resolves.toBeNull()
  })
})
