import { describe, expect, it, vi } from 'vitest'
import {
  BAR_DONE_MAX_MS, RESUME_KEY, TRIED_KEY, downloadProgress, parsePrecacheManifest, precacheKey, reloadForUpdatePush, runLaunchUpdate,
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
    // вниз: 199 из 200 — еще не 100% (на сплэше проценты, 26.10.2026)
    const keys = Array.from({ length: 200 }, (_, i) => String(i))
    expect(downloadProgress(keys, new Set(keys.slice(1))).pct).toBe(99)
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
  return { reg, sw, ui, reload, run, storage, fetchFn, sleep }
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

  it('перезагрузка — только когда полоска сплэша дошла до 100% и постояла', async () => {
    const s = setup()
    let barFull
    s.ui.installing.mockReturnValue(new Promise((r) => { barFull = r }))
    // потолок ожидания полоски не наступает — ждем только ее
    const sleep = (ms) => (ms === BAR_DONE_MAX_MS ? new Promise(() => {}) : s.sleep(ms))
    let result = null
    const run = s.run({ sleep }).then((r) => { result = r })
    await new Promise((r) => setTimeout(r, 0))
    expect(s.reg.waiting.postMessage).toHaveBeenCalled() // применяется параллельно с полоской
    expect(s.reload).not.toHaveBeenCalled()
    barFull()
    await run
    expect(result).toBe('applied')
    expect(s.reload).toHaveBeenCalledTimes(1)
  })

  it('полоска не отчиталась — перезагрузка все равно по потолку', async () => {
    const s = setup()
    s.ui.installing.mockReturnValue(new Promise(() => {}))
    expect(await s.run()).toBe('applied')
    expect(s.sleep).toHaveBeenCalledWith(BAR_DONE_MAX_MS)
    expect(s.reload).toHaveBeenCalledTimes(1)
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

// Обращение 19.10.2026: пуш «вышла версия» у запущенного приложения — сразу на сплэш обновления.
describe('reloadForUpdatePush', () => {
  const fetchVer = (version) => vi.fn(async () => ({ ok: true, json: async () => ({ version }) }))
  const base = (over = {}) => {
    const store = new Map([[TRIED_KEY, '1.1.0']])
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
    return { store, args: { fetchFn: fetchVer('1.1.0'), storage, versionUrl: '/version.json', currentVersion: '1.0.0', reload: vi.fn(), href: 'https://x.dev/app/?push=update#reset=1', ...over } }
  }

  it('новая версия на сервере — перезагрузка на адрес без ?push= и новая попытка сплэша', async () => {
    const { store, args } = base()
    expect(await reloadForUpdatePush(args)).toBe('reload')
    expect(args.reload).toHaveBeenCalledWith('https://x.dev/app/#reset=1')
    expect(args.fetchFn).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
    expect(store.has(TRIED_KEY)).toBe(false)
  })

  it('посреди записи тренировки — не трогаем (остается плашка)', async () => {
    const { args } = base({ composerOpen: true })
    expect(await reloadForUpdatePush(args)).toBe('composer')
    expect(args.fetchFn).not.toHaveBeenCalled()
    expect(args.reload).not.toHaveBeenCalled()
  })

  it('возврат из фона — перезагрузка одна на версию за сессию, флаг сплэша не трогаем', async () => {
    const { store, args } = base({ resume: true })
    expect(await reloadForUpdatePush(args)).toBe('reload')
    expect(store.get(RESUME_KEY)).toBe('1.1.0')
    expect(store.get(TRIED_KEY)).toBe('1.1.0')
    expect(await reloadForUpdatePush(args)).toBe('tried')
    expect(args.reload).toHaveBeenCalledTimes(1)
    args.fetchFn = fetchVer('1.2.0') // вышла еще одна — снова можно
    expect(await reloadForUpdatePush(args)).toBe('reload')
  })

  it('версия та же, сервер не ответил, офлайн — остаемся', async () => {
    for (const fetchFn of [fetchVer('1.0.0'), vi.fn(async () => ({ ok: false })), vi.fn(async () => { throw new Error('net') })]) {
      const { store, args } = base({ fetchFn })
      expect(await reloadForUpdatePush(args)).toBe('none')
      expect(args.reload).not.toHaveBeenCalled()
      expect(store.get(TRIED_KEY)).toBe('1.1.0')
    }
  })
})
