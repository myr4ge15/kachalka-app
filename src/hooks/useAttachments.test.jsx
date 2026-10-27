// @vitest-environment jsdom
// Предзагрузка вложений (20.10.2026): загрузка сразу после выбора, прогресс, ошибка и повтор,
// убрали во время загрузки — путь удаляется, когда загрузка закончится; ушли с экрана или
// «Отмена» — загруженное удаляется; отправленное (commit) — нет.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAttachments, AUTO_RETRIES, NOT_READY, STASH_TTL_MS, resetAttachmentStash } from './useAttachments.js'

const png = (n = 'a.png') => new File(['x'], n, { type: 'image/png' })
const mp4 = () => { const f = new File(['x'], 'v.mp4', { type: 'video/mp4' }); Object.defineProperty(f, 'size', { value: 1000 }); return f }
const deferred = () => { let ok, fail; const p = new Promise((a, b) => { ok = a; fail = b }); return { p, ok, fail } }

const coded = (code) => Object.assign(new Error(`сбой ${code}`), { code })
const wait = vi.fn(async () => {})

function setup(upload, poster = vi.fn(async () => null)) {
  const api = { upload: vi.fn(upload ?? (async (uid, f) => `${uid}/${f.name}`)), discard: vi.fn() }
  const hook = renderHook(() => useAttachments('me', api, { poster, wait }))
  return { api, poster, ...hook }
}

describe('useAttachments', () => {
  it('выбор — сразу загрузка; готово — путь и статус done', async () => {
    const { api, result } = setup()
    act(() => result.current.add([png()]))
    expect(result.current.items[0]).toMatchObject({ status: 'uploading', video: false })
    expect(result.current.uploading).toBe(1)
    await waitFor(() => expect(result.current.items[0]).toMatchObject({ status: 'done', path: 'me/a.png' }))
    expect(api.upload).toHaveBeenCalledWith('me', expect.any(File), { onBytes: expect.any(Function) })
    expect(result.current.progress).toBeNull()
  })

  it('видео — прогресс по байтам и кадр для миниатюры', async () => {
    const d = deferred()
    let bytes
    const { result } = setup((uid, f, { onBytes }) => { bytes = onBytes; return d.p }, vi.fn(async () => 'data:poster'))
    act(() => result.current.add([mp4()]))
    await waitFor(() => expect(result.current.items[0].poster).toBe('data:poster'))
    act(() => bytes(250))
    expect(result.current.items[0].loaded).toBe(250)
    expect(result.current.progress).toEqual({ loaded: 250, total: 1000 })
    await act(async () => d.ok('me/v.mp4'))
    expect(result.current.items[0]).toMatchObject({ status: 'done', loaded: 1000 })
  })

  it('ошибка — статус error, «Повторить» грузит заново', async () => {
    const { api, result } = setup()
    api.upload.mockRejectedValueOnce(new Error('Нет связи'))
    act(() => result.current.add([png()]))
    await waitFor(() => expect(result.current.items[0]).toMatchObject({ status: 'error', error: 'Нет связи' }))
    expect(result.current.failed).toBe(1)
    await expect(result.current.readyPaths()).rejects.toThrow(NOT_READY)
    act(() => result.current.retry(result.current.items[0].key))
    act(() => result.current.retry('нет-такого')) // ничего не ломает
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    expect(api.upload).toHaveBeenCalledTimes(2)
    await expect(result.current.readyPaths()).resolves.toEqual(['me/a.png'])
  })

  it('убрали загруженное — путь удаляется; убрали во время загрузки — удалится по окончании', async () => {
    const d = deferred()
    const { api, result } = setup()
    act(() => result.current.add([png('a.png')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    act(() => result.current.remove(result.current.items[0].key))
    expect(api.discard).toHaveBeenCalledWith(['me/a.png'])
    api.upload.mockImplementationOnce(() => d.p)
    act(() => result.current.add([png('b.png')]))
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2)) // загрузка пошла (очередь — асинхронно)
    act(() => result.current.remove(result.current.items[0].key))
    act(() => result.current.remove('нет-такого'))
    expect(result.current.items).toEqual([])
    await act(async () => d.ok('me/b.png'))
    expect(api.discard).toHaveBeenLastCalledWith(['me/b.png'])
  })

  it('readyPaths ждет идущие загрузки и отдает пути по порядку', async () => {
    const d = deferred()
    const { api, result } = setup()
    api.upload.mockImplementationOnce(() => d.p)
    act(() => result.current.add([png('a.png'), png('b.png')]))
    let paths
    const wait = act(async () => { paths = await result.current.readyPaths() })
    d.ok('me/a.png')
    await wait
    expect(paths).toEqual(['me/a.png', 'me/b.png'])
  })

  it('commit — забыть без удаления; clear — удалить загруженное', async () => {
    const { api, result, unmount } = setup()
    act(() => result.current.add([png('a.png')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    act(() => result.current.commit())
    expect(result.current.items).toEqual([])
    act(() => result.current.add([png('b.png')]))
    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'))
    act(() => result.current.clear())
    expect(api.discard).toHaveBeenCalledWith(['me/b.png'])
    expect(api.discard).not.toHaveBeenCalledWith(['me/a.png'])
    unmount()
    expect(api.discard).toHaveBeenCalledTimes(1) // пусто — нечего удалять (discard на [] не зовется)
  })

  it('ушли с экрана — загруженное удаляется, идущая загрузка удалит себя сама', async () => {
    const d = deferred()
    const { api, result, unmount } = setup()
    act(() => result.current.add([png('a.png')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    api.upload.mockImplementationOnce(() => d.p)
    act(() => result.current.add([png('b.png')]))
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2))
    unmount()
    expect(api.discard).toHaveBeenCalledWith(['me/a.png'])
    await act(async () => d.ok('me/b.png'))
    expect(api.discard).toHaveBeenLastCalledWith(['me/b.png'])
  })

  it('по одному: второе ждет, пока загрузится первое (fb_afd6d919)', async () => {
    const d = deferred()
    const { api, result } = setup()
    api.upload.mockImplementationOnce(() => d.p)
    act(() => result.current.add([mp4(), png('b.png')]))
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
    expect(result.current.items[1]).toMatchObject({ status: 'uploading', loaded: 0 })
    await act(async () => d.ok('me/v.mp4'))
    await waitFor(() => expect(result.current.items[1].status).toBe('done'))
    expect(api.upload).toHaveBeenCalledTimes(2)
  })

  it('обрыв сети — повтор сам, с нуля по байтам; ошибка данных — сразу «Повторить»', async () => {
    const { api, result } = setup()
    api.upload.mockRejectedValueOnce(coded('network')).mockRejectedValueOnce(coded('upload_stalled'))
    act(() => result.current.add([png('a.png')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    expect(api.upload).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalled()
    api.upload.mockRejectedValueOnce(coded('video_too_big'))
    act(() => result.current.add([png('b.png')]))
    await waitFor(() => expect(result.current.items[1].status).toBe('error'))
    expect(api.upload).toHaveBeenCalledTimes(4)
  })

  it('автоповторы кончились — «Повторить»', async () => {
    const { api, result } = setup(async () => { throw coded('network') })
    act(() => result.current.add([png('a.png')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('error'))
    expect(api.upload).toHaveBeenCalledTimes(AUTO_RETRIES + 1)
  })

  it('убрали, пока ждал очереди, — не грузится вовсе', async () => {
    const d = deferred()
    const { api, result } = setup()
    api.upload.mockImplementationOnce(() => d.p)
    act(() => result.current.add([png('a.png'), png('b.png')]))
    act(() => result.current.remove(result.current.items[1].key))
    await act(async () => d.ok('me/a.png'))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    expect(api.upload).toHaveBeenCalledTimes(1)
  })
})

// fb_37f0c1a8: свернули приложение — iOS рвет загрузку; это не попытка, после возврата — заново сам.
describe('useAttachments: сворачивание приложения', () => {
  const setVisibility = (state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  }
  afterEach(() => { delete document.visibilityState })

  it('обрыв в фоне ждет возврата и не съедает автоповторы', async () => {
    const d = deferred()
    const { api, result } = setup()
    api.upload.mockImplementationOnce(() => d.p)
    wait.mockClear()
    act(() => result.current.add([mp4()]))
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
    setVisibility('hidden')
    await act(async () => d.fail(coded('network')))
    expect(api.upload).toHaveBeenCalledTimes(1) // пока свернуто — не грузим
    expect(result.current.items[0].status).toBe('uploading')
    setVisibility('visible')
    await waitFor(() => expect(result.current.items[0]).toMatchObject({ status: 'done', path: 'me/v.mp4' }))
    expect(api.upload).toHaveBeenCalledTimes(2)
    expect(wait).not.toHaveBeenCalled() // без паузы автоповтора
  })

  it('обрыв пришел уже после возврата — тоже заново, даже «нет сети»', async () => {
    const d = deferred()
    const { api, result } = setup()
    api.upload.mockImplementationOnce(() => d.p)
    act(() => result.current.add([png('a.png')]))
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
    setVisibility('hidden')
    setVisibility('visible')
    await act(async () => d.fail(coded('offline')))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
    expect(api.upload).toHaveBeenCalledTimes(2)
  })

  it('ошибка данных после сворачивания — сразу «Повторить»', async () => {
    const d = deferred()
    const { api, result } = setup()
    api.upload.mockImplementationOnce(() => d.p)
    act(() => result.current.add([png('a.png')]))
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
    setVisibility('hidden')
    setVisibility('visible')
    await act(async () => d.fail(coded('video_too_big')))
    await waitFor(() => expect(result.current.items[0].status).toBe('error'))
    expect(api.upload).toHaveBeenCalledTimes(1)
  })

  describe('stash — черновик формы (fb_4d192432)', () => {
    beforeEach(() => resetAttachmentStash()) // прошлый тест отложил свое при авто-размонтировании
    afterEach(() => { resetAttachmentStash(); vi.useRealTimers() })
    const open = (api) => renderHook(() => useAttachments('me', api, { poster: vi.fn(async () => null), wait, stash: 'fb_me' }))

    it('ушли с экрана — загруженное ждет и возвращается; идущая загрузка удаляется как раньше', async () => {
      const d = deferred()
      const api = { upload: vi.fn(async (uid, f) => (f.name === 'slow.png' ? d.p : `${uid}/${f.name}`)), discard: vi.fn() }
      const first = open(api)
      act(() => first.result.current.add([png('a.png'), png('slow.png')]))
      await waitFor(() => expect(first.result.current.items[0].status).toBe('done'))
      first.unmount()
      expect(api.discard).not.toHaveBeenCalled()
      await act(async () => d.ok('me/slow.png'))
      await waitFor(() => expect(api.discard).toHaveBeenCalledWith(['me/slow.png']))
      const again = open(api)
      expect(again.result.current.items).toHaveLength(1)
      expect(again.result.current.items[0]).toMatchObject({ status: 'done', path: 'me/a.png' })
      await expect(again.result.current.readyPaths()).resolves.toEqual(['me/a.png'])
      act(() => again.result.current.add([png('b.png')]))
      expect(new Set(again.result.current.items.map((x) => x.key)).size).toBe(2) // ключи не повторяются
    })

    it('черновик старше срока не возвращается — файлы удаляются', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const api = { upload: vi.fn(async (uid, f) => `${uid}/${f.name}`), discard: vi.fn() }
      const first = open(api)
      act(() => first.result.current.add([png('a.png')]))
      await waitFor(() => expect(first.result.current.items[0].status).toBe('done'))
      first.unmount()
      vi.setSystemTime(Date.now() + STASH_TTL_MS + 1000)
      const again = open(api)
      expect(again.result.current.items).toEqual([])
      expect(api.discard).toHaveBeenCalledWith(['me/a.png'])
    })
  })
})
