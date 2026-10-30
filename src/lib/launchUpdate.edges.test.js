// lib/launchUpdate.js — края обновления при запуске (покрытие веток, 30.10.2026): на слабой связи и
// при любом сбое человек попадает в текущую версию, сплэш не держится дольше обещанного, запись
// тренировки не прерывается. Основной сценарий — launchUpdate.test.js. Там, где важен именно срок,
// работают настоящие обработчики по умолчанию на фейковых часах.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPLY_TIMEOUT_MS, BAR_DONE_MAX_MS, SPLASH_RESUME_KEY, FALLBACK_SHOW_MS, MAX_WAIT_MS, POLL_MS, RESUME_KEY, STALL_MS, TRIED_KEY,
  VERSION_TIMEOUT_MS, downloadProgress, parsePrecacheManifest, precacheKey, reloadForUpdatePush, runLaunchUpdate,
} from './launchUpdate.js'
import { SPLASH_HARD_MS } from './splashBoot.js'

const VERSION_URL = '/app/version.json'
const SCRIPT = 'https://x.dev/app/sw.js'
const OLD = 'https://x.dev/app/assets/old.js'
const manifest = (n) => `precacheAndRoute([${Array.from({ length: n }, (_, i) => `{url:"f${i}.js",revision:null}`).join(',')}])`
const fileKey = (i) => `https://x.dev/app/f${i}.js`

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }
}

const brokenStorage = () => ({
  getItem: () => { throw new Error('private') },
  setItem: () => { throw new Error('private') },
  removeItem: () => { throw new Error('private') },
})

// Регистрация и часы под управлением теста; onTick(t, h) зовется на каждом сне.
function harness({ version = '2.0.0', regOver = {}, sw: swOver = {}, script, onTick, swText = manifest(3) } = {}) {
  const listeners = {}
  const reg = { active: {}, waiting: null, installing: null, update: vi.fn(async () => {}), ...regOver }
  const sw = {
    getRegistration: vi.fn(async () => reg),
    addEventListener: vi.fn((ev, fn) => { listeners[ev] = fn }),
    ...swOver,
  }
  const cached = new Set([OLD])
  const cachesApi = {
    keys: async () => ['other-cache', 'workbox-precache-v2'],
    open: async () => ({ keys: async () => [...cached].map((url) => ({ url })) }),
  }
  const fetchFn = vi.fn(async (url) => {
    if (url === VERSION_URL) return { ok: true, json: async () => ({ version }) }
    return script ? script() : { ok: true, text: async () => swText }
  })
  const h = { t: 0, reg, sw, listeners, cached, cachesApi, fetchFn, storage: makeStorage(), reload: vi.fn(), fallbackAt: null }
  h.ui = { start: vi.fn(), progress: vi.fn(), installing: vi.fn(), fallback: vi.fn(() => { h.fallbackAt = h.t }) }
  h.sleep = vi.fn(async (ms) => { h.t += ms; onTick?.(h.t, h) })
  h.run = (extra = {}) => runLaunchUpdate({
    sw, online: true, fetchFn, cachesApi, storage: h.storage, ui: h.ui, sleep: h.sleep, reload: h.reload,
    versionUrl: VERSION_URL, currentVersion: '1.0.0', now: () => h.t, ...extra,
  })
  return h
}

const waitingWorker = (over = {}) => ({ postMessage: vi.fn(), ...over })
// SW поставился: появился installing, а через шаг — waiting.
const installing = (extra = {}) => ({ regOver: { installing: { scriptURL: SCRIPT } }, ...extra })

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('чистые части: края', () => {
  it('пустая ревизия не дает параметра, абсолютный адрес остается абсолютным', () => {
    expect(parsePrecacheManifest('{url:"a.js",revision:""}')).toEqual([{ url: 'a.js', revision: '' }])
    expect(precacheKey({ url: 'a.js', revision: '' }, SCRIPT)).toBe('https://x.dev/app/a.js')
    expect(precacheKey({ url: 'https://cdn.dev/a.js', revision: null }, SCRIPT)).toBe('https://cdn.dev/a.js')
  })

  it('100% — только когда скачано все', () => {
    expect(downloadProgress(['a', 'b'], new Set(['a', 'b']))).toEqual({ done: 2, total: 2, pct: 100 })
  })
})

describe('runLaunchUpdate: когда сразу внутрь', () => {
  it('нет service worker, fetch или регистрации — skip, сплэш не держим', async () => {
    const h = harness()
    expect(await h.run({ sw: null })).toBe('skip')
    expect(await h.run({ fetchFn: null })).toBe('skip')
    h.sw.getRegistration.mockResolvedValueOnce(undefined)
    expect(await h.run()).toBe('skip')
    h.sw.getRegistration.mockRejectedValueOnce(new Error('denied'))
    expect(await h.run()).toBe('skip')
    expect(h.ui.start).not.toHaveBeenCalled()
  })

  it('вызов без параметров вне браузера — skip, а не исключение', async () => {
    expect(await runLaunchUpdate()).toBe('skip')
  })

  it('регистрация зависла — через 2 с внутрь', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sw.getRegistration.mockReturnValue(new Promise(() => {}))
    let result = null
    h.run().then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(1999)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe('skip')
  })

  it('version.json завис — через VERSION_TIMEOUT_MS внутрь, обновление не начинаем', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.fetchFn.mockReturnValue(new Promise(() => {}))
    let result = null
    h.run().then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(VERSION_TIMEOUT_MS - 1)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe('none')
    expect(h.reg.update).not.toHaveBeenCalled()
  })

  it.each([
    ['404', { ok: false }],
    ['нет поля version', { ok: true, json: async () => ({}) }],
    ['null в теле', { ok: true, json: async () => null }],
    ['тело не JSON', { ok: true, json: async () => { throw new SyntaxError('html') } }],
  ])('версию не узнали (%s) — внутрь', async (_name, answer) => {
    const h = harness()
    h.fetchFn.mockResolvedValue(answer)
    expect(await h.run()).toBe('none')
    expect(h.ui.start).not.toHaveBeenCalled()
  })

  it('заголовки version.json пришли, тело зависло — внутрь за VERSION_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.fetchFn.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) })
    let result = null
    h.run().then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(VERSION_TIMEOUT_MS + 1)
    expect(result).toBe('none')
  })

  it('числовая версия сравнивается как строка: второй раз не пытаемся', async () => {
    const h = harness({ version: 7 })
    h.storage.setItem(TRIED_KEY, '7')
    expect(await h.run()).toBe('retried')
  })
})

describe('runLaunchUpdate: слабая связь', () => {
  it('«Связь слабая» показывается положенное время, новая попытка на следующем запуске не сгорает', async () => {
    const h = harness()
    expect(await h.run({ waitMs: 1000, maxWaitMs: 1000 })).toBe('fallback')
    expect(h.sleep).toHaveBeenLastCalledWith(FALLBACK_SHOW_MS)
    expect(h.reload).not.toHaveBeenCalled()
    expect(h.storage.map.has(TRIED_KEY)).toBe(false)
    h.reg.waiting = waitingWorker()
    expect(await h.run()).toBe('applied') // докачанное применяется при следующем запуске
  })

  it('прогресс встал — ждем STALL_MS после последнего файла и выходим', async () => {
    const h = harness({
      ...installing(),
      onTick: (t, x) => { if (t === 750) x.cached.add(fileKey(0)) },
    })
    expect(await h.run({ waitMs: 1000, maxWaitMs: 60000 })).toBe('fallback')
    expect(h.fallbackAt).toBeGreaterThanOrEqual(750 + STALL_MS)
    expect(h.fallbackAt).toBeLessThanOrEqual(750 + STALL_MS + POLL_MS)
  })

  it('прогресс не встает — все равно выходим на потолке maxWaitMs', async () => {
    const h = harness({
      ...installing(),
      swText: manifest(1000),
      onTick: (t, x) => { x.cached.add(fileKey(t / POLL_MS)) },
    })
    expect(await h.run({ waitMs: 1000, maxWaitMs: 5000 })).toBe('fallback')
    expect(h.fallbackAt).toBeLessThanOrEqual(5000 + POLL_MS)
  })

  it('maxWaitMs меньше waitMs — действует waitMs', async () => {
    const h = harness()
    expect(await h.run({ waitMs: 1000, maxWaitMs: 100 })).toBe('fallback')
    expect(h.fallbackAt).toBe(1000)
  })

  it('reg.update упал (нет сети) — без необработанного reject, ждем и выходим', async () => {
    const h = harness()
    h.reg.update.mockRejectedValue(new TypeError('offline'))
    expect(await h.run({ waitMs: 500 })).toBe('fallback')
  })

  it('запрос sw.js завис — «Связь слабая» и внутрь не позже потолка', async () => {
    vi.useFakeTimers()
    const h = harness({ ...installing(), script: () => new Promise(() => {}) })
    let result = null
    h.run({ sleep: undefined, now: undefined }).then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + FALLBACK_SHOW_MS + 1000)
    expect(result).toBe('fallback')
  })

  it('обычные часы и сон по умолчанию: без новой версии выходим к сроку', async () => {
    vi.useFakeTimers()
    const h = harness()
    let result = null
    h.run({ sleep: undefined, now: undefined, waitMs: 1000 }).then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(result).toBe('fallback')
    expect(h.ui.fallback).toHaveBeenCalledTimes(1)
  })

  it('сплэш не снимается раньше, чем закончится ожидание обновления', () => {
    expect(SPLASH_HARD_MS).toBeGreaterThan(MAX_WAIT_MS)
  })
})

describe('runLaunchUpdate: порядок применения', () => {
  it('SKIP_WAITING уходит только после полоски и «Устанавливаем…» (fb_96e976ff)', async () => {
    const h = harness()
    const worker = waitingWorker()
    h.reg.waiting = worker
    let barFinished
    h.ui.installing = vi.fn(() => new Promise((r) => { barFinished = r }))
    const run = h.run({ sleep: (ms) => (ms === BAR_DONE_MAX_MS ? new Promise(() => {}) : Promise.resolve()) })
    await vi.waitFor(() => expect(h.ui.installing).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(worker.postMessage).not.toHaveBeenCalled()
    barFinished()
    expect(await run).toBe('applied')
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('перед перезагрузкой ставится метка для сплэша', async () => {
    const h = harness()
    h.reg.waiting = waitingWorker()
    expect(await h.run()).toBe('applied')
    expect(h.storage.map.get(SPLASH_RESUME_KEY)).toBe('1')
  })

  it('«Связь слабая»: перезагрузки нет — метки нет', async () => {
    const h = harness()
    expect(await h.run({ waitMs: 1000, maxWaitMs: 1000 })).toBe('fallback')
    expect(h.storage.map.has(SPLASH_RESUME_KEY)).toBe(false)
  })

  it('полоска зависла — активация все равно уходит по BAR_DONE_MAX_MS', async () => {
    const h = harness()
    const worker = waitingWorker()
    h.reg.waiting = worker
    h.ui.installing = vi.fn(() => new Promise(() => {}))
    expect(await h.run()).toBe('applied')
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })
})

describe('runLaunchUpdate: прогресс', () => {
  it('файлы, что уже были в кэше, в расчет не идут', async () => {
    const h = harness({
      ...installing(),
      swText: 'precacheAndRoute([{url:"assets/old.js",revision:null},{url:"f0.js",revision:null},{url:"f1.js",revision:null}])',
      onTick: (t, x) => { if (t >= 500) x.reg.waiting = waitingWorker() },
    })
    expect(await h.run()).toBe('applied')
    expect(h.ui.progress.mock.calls[0][0]).toEqual({ done: 0, total: 2, pct: 0 })
  })

  it('манифест запрашивается один раз, а не на каждом шаге', async () => {
    const h = harness({ ...installing(), onTick: (t, x) => { if (t >= 1000) x.reg.waiting = waitingWorker() } })
    await h.run()
    expect(h.fetchFn.mock.calls.filter(([u]) => u === SCRIPT)).toHaveLength(1)
  })

  it.each([
    ['404', () => ({ ok: false })],
    ['сеть', () => { throw new TypeError('offline') }],
    ['манифест не разобран', () => ({ ok: true, text: async () => 'мусор' })],
  ])('sw.js недоступен (%s): без цифр, но обновление идет до конца', async (_name, script) => {
    const h = harness({ ...installing(), script, onTick: (t, x) => { if (t >= 500) x.reg.waiting = waitingWorker() } })
    expect(await h.run()).toBe('applied')
    expect(h.ui.progress).not.toHaveBeenCalled()
    expect(h.fetchFn.mock.calls.filter(([u]) => u === SCRIPT)).toHaveLength(1)
  })

  it.each([
    ['нет Cache API', null],
    ['нет кэша precache', { keys: async () => ['other'], open: vi.fn() }],
    ['сбой кэша', { keys: async () => { throw new Error('quota') } }],
  ])('%s: прогресс нулевой, ничего не падает', async (_name, cachesApi) => {
    const h = harness({ ...installing(), onTick: (t, x) => { if (t >= 500) x.reg.waiting = waitingWorker() } })
    expect(await h.run({ cachesApi })).toBe('applied')
    expect(h.ui.progress.mock.calls[0][0]).toMatchObject({ done: 0, total: 3 })
  })
})

describe('runLaunchUpdate: применение', () => {
  it('сплэш без блока обновления (ui не передан) — применяется молча', async () => {
    const h = harness({ regOver: { waiting: waitingWorker() } })
    expect(await h.run({ ui: undefined })).toBe('applied')
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('без ui и на слабой связи — fallback без исключений', async () => {
    const h = harness({ ...installing() })
    expect(await h.run({ ui: {}, waitMs: 500, maxWaitMs: 500 })).toBe('fallback')
  })

  it('смена контроллера не пришла — ждем APPLY_TIMEOUT_MS и перезагружаем сами', async () => {
    const h = harness({ regOver: { waiting: waitingWorker() } })
    expect(await h.run()).toBe('applied')
    expect(h.sleep).toHaveBeenCalledWith(APPLY_TIMEOUT_MS)
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('смена контроллера пришла — таймаут применения не нужен', async () => {
    const h = harness()
    h.reg.waiting = waitingWorker({ postMessage: vi.fn(() => h.listeners.controllerchange()) })
    const sleep = (ms) => (ms === APPLY_TIMEOUT_MS ? new Promise(() => {}) : h.sleep(ms))
    expect(await h.run({ sleep })).toBe('applied')
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('ждущий SW умер (postMessage бросил) — страница все равно перезагружается', async () => {
    const worker = { postMessage: () => { throw new Error('redundant') } }
    const h = harness({ regOver: { waiting: worker } })
    const sleep = (ms) => (ms === APPLY_TIMEOUT_MS ? new Promise(() => {}) : h.sleep(ms))
    expect(await h.run({ sleep })).toBe('applied')
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('sw без addEventListener — выходим по таймауту применения', async () => {
    const h = harness({ regOver: { waiting: waitingWorker() }, sw: { addEventListener: undefined } })
    expect(await h.run()).toBe('applied')
  })

  it.each([
    ['бросает', () => { throw new Error('dom') }],
    ['отклоняет', async () => { throw new Error('dom') }],
    ['возвращает не промис', () => 'ok'],
  ])('installing() сплэша %s — обновление не срывается', async (_name, impl) => {
    const h = harness({ regOver: { waiting: waitingWorker() } })
    h.ui.installing.mockImplementation(impl)
    expect(await h.run()).toBe('applied')
    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.storage.getItem(TRIED_KEY)).toBe('2.0.0')
  })

  it('sessionStorage недоступен — обновление работает, петли защита не дает, но и не падает', async () => {
    const h = harness({ regOver: { waiting: waitingWorker() } })
    expect(await h.run({ storage: brokenStorage() })).toBe('applied')
    expect(await h.run({ storage: null })).toBe('applied')
    expect(h.reload).toHaveBeenCalledTimes(2)
  })

  it('перезагрузка по умолчанию — window.location.reload', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    const h = harness({ regOver: { waiting: waitingWorker() } })
    expect(await h.run({ reload: undefined })).toBe('applied')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(h.sleep).toHaveBeenCalledWith(BAR_DONE_MAX_MS)
  })
})

describe('reloadForUpdatePush: края', () => {
  const fetchVer = (version) => vi.fn(async () => ({ ok: true, json: async () => ({ version }) }))
  const args = (over = {}) => ({
    fetchFn: fetchVer('2.0.0'), storage: makeStorage(), versionUrl: VERSION_URL, currentVersion: '1.0.0',
    reload: vi.fn(), href: 'https://x.dev/app/?push=update', ...over,
  })

  it('запись тренировки важнее даже при возврате из фона: ни сети, ни отметок', async () => {
    const a = args({ composerOpen: true, resume: true })
    expect(await reloadForUpdatePush(a)).toBe('composer')
    expect(a.fetchFn).not.toHaveBeenCalled()
    expect(a.reload).not.toHaveBeenCalled()
    expect(a.storage.map.size).toBe(0)
  })

  it('нет fetch — остаемся', async () => {
    const a = args({ fetchFn: null })
    expect(await reloadForUpdatePush(a)).toBe('none')
    expect(a.reload).not.toHaveBeenCalled()
  })

  it('сервер завис — через VERSION_TIMEOUT_MS остаемся, не перезагружаем', async () => {
    vi.useFakeTimers()
    const a = args({ fetchFn: vi.fn(() => new Promise(() => {})) })
    let result = null
    reloadForUpdatePush(a).then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(VERSION_TIMEOUT_MS)
    expect(result).toBe('none')
    expect(a.reload).not.toHaveBeenCalled()
  })

  it.each([
    ['нет поля version', async () => ({})],
    ['null в теле', async () => null],
    ['тело не JSON', async () => { throw new SyntaxError('html') }],
  ])('версию не узнали (%s) — остаемся', async (_name, json) => {
    const a = args({ fetchFn: vi.fn(async () => ({ ok: true, json })) })
    expect(await reloadForUpdatePush(a)).toBe('none')
  })

  it('возврат из фона без новой версии — отметку не ставим, следующая версия не потеряется', async () => {
    const a = args({ fetchFn: fetchVer('1.0.0'), resume: true })
    expect(await reloadForUpdatePush(a)).toBe('none')
    expect(a.storage.map.has(RESUME_KEY)).toBe(false)
  })

  it('sessionStorage недоступен: нажатие и возврат все равно ведут на сплэш', async () => {
    for (const resume of [false, true]) {
      for (const storage of [brokenStorage(), null]) {
        const a = args({ storage, resume })
        expect(await reloadForUpdatePush(a)).toBe('reload')
        expect(a.reload).toHaveBeenCalledTimes(1)
      }
    }
  })

  it('адрес не разобрать — перезагружаем его как есть', async () => {
    const a = args({ href: 'не адрес' })
    expect(await reloadForUpdatePush(a)).toBe('reload')
    expect(a.reload).toHaveBeenCalledWith('не адрес')
  })

  it('по умолчанию: адрес без push ставится ДО перезагрузки, остальное в нем сохраняется', async () => {
    const replaceState = vi.fn()
    const reload = vi.fn()
    vi.stubGlobal('window', {
      history: { state: { tab: 'home' }, replaceState },
      location: { href: 'https://x.dev/app/?push=update&a=1#reset=t', reload },
    })
    expect(await reloadForUpdatePush({ fetchFn: fetchVer('2.0.0'), storage: makeStorage(), versionUrl: VERSION_URL, currentVersion: '1.0.0' })).toBe('reload')
    expect(replaceState).toHaveBeenCalledWith({ tab: 'home' }, '', 'https://x.dev/app/?a=1#reset=t')
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0])
  })

  it('вызов без параметров вне браузера — fetch есть, версии нет, остаемся', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await reloadForUpdatePush()).toBe('none')
  })
})
