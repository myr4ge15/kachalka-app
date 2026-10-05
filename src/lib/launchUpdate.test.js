import { describe, expect, it, vi } from 'vitest'
import {
  TRIED_KEY, downloadProgress, parsePrecacheManifest, precacheKey, runLaunchUpdate,
} from './launchUpdate.js'

const SW_TEXT = 'e.precacheAndRoute([{url:"index.html",revision:"abc"},{url:"assets/app-1.js",revision:null},{url:"assets/app-1.css",revision:null}],{})'
const BASE = 'https://x.dev/app/sw.js'

describe('чистые части', () => {
  it('разбирает манифест precache и строит ключи Workbox', () => {
    const m = parsePrecacheManifest(SW_TEXT)
    expect(m).toEqual([
      { url: 'index.html', revision: 'abc' },
      { url: 'assets/app-1.js', revision: null },
      { url: 'assets/app-1.css', revision: null },
    ])
    expect(m.map((e) => precacheKey(e, BASE))).toEqual([
      'https://x.dev/app/index.html?__WB_REVISION__=abc',
      'https://x.dev/app/assets/app-1.js',
      'https://x.dev/app/assets/app-1.css',
    ])
    expect(parsePrecacheManifest('мусор')).toEqual([])
    expect(parsePrecacheManifest(null)).toEqual([])
  })

  it('прогресс — доля скачанных из нужных', () => {
    expect(downloadProgress(['a', 'b', 'c', 'd'], new Set(['a', 'c', 'z']))).toEqual({ done: 2, total: 4, pct: 50 })
    expect(downloadProgress([], new Set())).toBeNull()
  })
})

// Фейковый service worker: управляем состоянием регистрации по шагам.
function setup({ server = '6.13.0', current = '6.12.1', waiting = null, active = true, online = true, installAfter = 2 } = {}) {
  const listeners = {}
  const reg = {
    active: active ? {} : null,
    waiting,
    installing: null,
    update: vi.fn(async () => {}),
  }
  const sw = {
    getRegistration: vi.fn(async () => reg),
    addEventListener: vi.fn((ev, fn) => { listeners[ev] = fn }),
  }
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const cacheKeys = new Set(['https://x.dev/app/assets/old.js'])
  const cachesApi = {
    keys: async () => ['workbox-precache-v2-https://x.dev/app/'],
    open: async () => ({ keys: async () => [...cacheKeys].map((url) => ({ url })) }),
  }
  const fetchFn = vi.fn(async (url) => {
    if (url === '/app/version.json') return { ok: true, json: async () => ({ version: server }) }
    return { ok: true, text: async () => SW_TEXT }
  })
  let t = 0
  let ticks = 0
  const sleep = vi.fn(async (ms) => {
    t += ms
    ticks++
    // Через пару тиков SW «ставится»: появляется installing, файлы падают в кэш, потом waiting.
    if (ticks === 1 && installAfter !== null) reg.installing = { scriptURL: BASE }
    if (ticks === installAfter) { cacheKeys.add('https://x.dev/app/assets/app-1.js') }
    if (installAfter !== null && ticks === installAfter + 1) {
      cacheKeys.add('https://x.dev/app/index.html?__WB_REVISION__=abc')
      cacheKeys.add('https://x.dev/app/assets/app-1.css')
      reg.waiting = { postMessage: vi.fn(() => listeners.controllerchange?.()) }
      reg.installing = null
    }
  })
  const ui = { start: vi.fn(), progress: vi.fn(), installing: vi.fn(), fallback: vi.fn() }
  const reload = vi.fn()
  const run = (extra = {}) => runLaunchUpdate({
    sw, online, fetchFn, cachesApi, storage, ui, sleep, reload,
    versionUrl: '/app/version.json', currentVersion: current, now: () => t, ...extra,
  })
  return { reg, sw, ui, reload, run, storage, fetchFn }
}

describe('runLaunchUpdate', () => {
  it('новая версия: качает с прогрессом, применяет и перезагружает', async () => {
    const s = setup()
    expect(await s.run()).toBe('applied')
    expect(s.ui.start).toHaveBeenCalledWith('6.13.0')
    expect(s.reg.update).toHaveBeenCalled()
    const pcts = s.ui.progress.mock.calls.map((c) => c[0]?.pct)
    expect(pcts).toContain(33)
    expect(s.ui.installing).toHaveBeenCalled()
    expect(s.reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(s.reload).toHaveBeenCalledTimes(1)
    expect(s.storage.getItem(TRIED_KEY)).toBe('6.13.0')
  })

  it('уже скачанная версия применяется сразу, без ожидания', async () => {
    const waiting = { postMessage: vi.fn() }
    const s = setup({ waiting, installAfter: null })
    expect(await s.run()).toBe('applied')
    expect(s.reg.update).not.toHaveBeenCalled()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(s.reload).toHaveBeenCalled()
  })

  it('та же версия, офлайн, первая установка — сразу внутрь', async () => {
    expect(await setup({ server: '6.12.1' }).run()).toBe('none')
    expect(await setup({ online: false }).run()).toBe('skip')
    expect(await setup({ active: false }).run()).toBe('skip')
    const s = setup()
    s.fetchFn.mockImplementation(async () => { throw new TypeError('offline') })
    expect(await s.run()).toBe('none') // версию не узнали — сплэш не держим
    expect(s.ui.start).not.toHaveBeenCalled()
  })

  it('слабая сеть: не успели за лимит — «связь слабая» и внутрь, без перезагрузки', async () => {
    const s = setup({ installAfter: 1000 })
    expect(await s.run({ waitMs: 3000 })).toBe('fallback')
    expect(s.ui.fallback).toHaveBeenCalled()
    expect(s.reload).not.toHaveBeenCalled()
  })

  it('загрузка идет дольше лимита — ждем, пока прогресс двигается', async () => {
    const s = setup({ installAfter: 20 }) // файлы падают на 20-м тике (≈5 с), лимит 3 с
    expect(await s.run({ waitMs: 3000, maxWaitMs: 30000 })).toBe('fallback') // прогресса до 20-го тика нет
    const s2 = setup({ installAfter: 4 })
    expect(await s2.run({ waitMs: 500, maxWaitMs: 30000 })).toBe('applied') // первый файл пришел до лимита — дождались
  })

  it('после перезагрузки версия все та же (CDN отстал) — второй раз не пытаемся', async () => {
    const s = setup()
    s.storage.setItem(TRIED_KEY, '6.13.0')
    expect(await s.run()).toBe('retried')
    expect(s.ui.start).not.toHaveBeenCalled()
  })
})
