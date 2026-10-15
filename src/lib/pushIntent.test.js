import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { appendPushLog, clearPushLog, LAST_PUSH_KEY, LAST_PUSH_TTL_MS, takeTappedPushUrl, onPushOpen, PENDING_TTL_MS, PUSH_LOG_MAX, readPushLog, PUSH_INTENT_KEY, pushIntentFromTag, pushIntentFromUrl, startPushListener, stripPushParam, takePendingPushUrl } from './pushIntent.js'

const W = '3f2c9a1e-0b4d-4c7e-9a10-5e6f7a8b9c0d'
const U = 'aa11bb22-cc33-4d44-8e55-66ff77889900'

describe('pushIntent', () => {
  it('реакция ведет к своей тренировке в Ленте', () => {
    expect(pushIntentFromTag(`reaction-${W}-${U}`)).toEqual({ type: 'reaction', workoutId: W })
  })

  it('id из tag приводится к нижнему регистру', () => {
    expect(pushIntentFromTag(`reaction-${W.toUpperCase()}-${U}`)?.workoutId).toBe(W)
  })

  it('ответ на обращение ведет на экран обратной связи', () => {
    expect(pushIntentFromTag(`feedback-${W.toUpperCase()}`)).toEqual({ type: 'feedback', feedbackId: W })
    expect(pushIntentFromTag(`feedback-${W}-x`)).toBeNull()
  })

  it('отдых закончился ведет к новой тренировке', () => {
    expect(pushIntentFromTag('rest')).toEqual({ type: 'rest' })
    expect(pushIntentFromTag('friend')).toEqual({ type: 'friend' })
    expect(pushIntentFromTag('rest-x')).toBeNull()
  })

  it('остальные и битые tag — без намерения', () => {
    expect(pushIntentFromTag(`record-${W}`)).toBeNull()
    expect(pushIntentFromTag('reaction-123-456')).toBeNull()
    expect(pushIntentFromTag('')).toBeNull()
    expect(pushIntentFromTag(null)).toBeNull()
  })

  it('читает намерение из адреса и не падает на мусоре', () => {
    const href = `https://x.github.io/kachalka-app/?push=${encodeURIComponent(`reaction-${W}-${U}`)}`
    expect(pushIntentFromUrl(href)).toEqual({ type: 'reaction', workoutId: W })
    expect(pushIntentFromUrl('https://x.github.io/kachalka-app/')).toBeNull()
    expect(pushIntentFromUrl('не адрес')).toBeNull()
  })

  it('убирает только параметр push, сохраняя остальное', () => {
    expect(stripPushParam('https://x.io/app/?push=a&b=1#h')).toBe('/app/?b=1#h')
    expect(stripPushParam('https://x.io/app/?push=a')).toBe('/app/')
    expect(stripPushParam('https://x.io/app/')).toBeNull()
  })
})

describe('pushIntent — новая версия', () => {
  it('tag update → намерение обновиться (и из адреса)', () => {
    expect(pushIntentFromTag('update')).toEqual({ type: 'update' })
    expect(pushIntentFromUrl('https://x.io/app/?push=update')).toEqual({ type: 'update' })
    expect(pushIntentFromTag('updates')).toBeNull()
  })
})

// Cache Storage в памяти — как кэш, куда пишет service worker.
function fakeCaches(entry) {
  const map = new Map(entry ? [[PUSH_INTENT_KEY, JSON.stringify(entry)]] : [])
  const cache = {
    match: async (k) => { const v = map.get(k); return v === undefined ? undefined : { json: async () => JSON.parse(v) } },
    delete: async (k) => map.delete(k),
  }
  return { store: { open: async () => cache }, map }
}

describe('takePendingPushUrl (v8.9.2)', () => {
  const url = 'https://x.ru/kachalka-app/?push=feedback-' + W
  it('свежее нажатие отдается один раз', async () => {
    const { store, map } = fakeCaches({ url, at: 1000 })
    expect(await takePendingPushUrl(1000 + 5000, store)).toBe(url)
    expect(map.size).toBe(0)
    expect(await takePendingPushUrl(1000 + 6000, store)).toBeNull()
  })
  it('старое и битое — null, но запись снимается', async () => {
    const old = fakeCaches({ url, at: 0 })
    expect(await takePendingPushUrl(PENDING_TTL_MS + 1, old.store)).toBeNull()
    expect(old.map.size).toBe(0)
    expect(await takePendingPushUrl(10, fakeCaches({ url: 5, at: 1 }).store)).toBeNull()
  })
  it('нет кэша — null', async () => {
    expect(await takePendingPushUrl(1, undefined)).toBeNull()
    expect(await takePendingPushUrl(1, fakeCaches(null).store)).toBeNull()
  })
})

describe('startPushListener / onPushOpen (v8.9.3)', () => {
  function fakeSw() {
    let handler = null
    return {
      addEventListener: (_t, fn) => { handler = fn },
      removeEventListener: () => { handler = null },
      startMessages: vi.fn(),
      send: (data, port) => handler?.({ data, ports: port ? [port] : [] }),
    }
  }
  it('сообщение до подписки навигации не теряется, SW получает ответ сразу', () => {
    const sw = fakeSw()
    const stop = startPushListener(sw)
    expect(sw.startMessages).toHaveBeenCalled()
    const port = { postMessage: vi.fn() }
    sw.send({ type: 'push-open', url: 'u1' }, port)
    expect(port.postMessage).toHaveBeenCalledWith('ok')
    const got = []
    const off = onPushOpen((u) => got.push(u))
    expect(got).toEqual(['u1'])
    sw.send({ type: 'push-open', url: 'u2' })
    sw.send({ type: 'other', url: 'x' })
    expect(got).toEqual(['u1', 'u2'])
    off(); stop()
  })
  it('без service worker — тихо', () => {
    expect(typeof startPushListener(undefined)).toBe('function')
  })
})

describe('журнал нажатий (v8.9.4)', () => {
  function memCaches() {
    const map = new Map()
    const cache = {
      match: async (k) => { const v = map.get(k); return v === undefined ? undefined : { json: async () => JSON.parse(v) } },
      put: async (k, res) => { map.set(k, await res.text()) },
      delete: async (k) => map.delete(k),
    }
    return { open: async () => cache }
  }
  it('пишет по порядку, хранит последние PUSH_LOG_MAX, чистится', async () => {
    const store = memCaches()
    for (let i = 0; i < PUSH_LOG_MAX + 3; i++) await appendPushLog('step', i, store, 1000 + i)
    const list = await readPushLog(store)
    expect(list).toHaveLength(PUSH_LOG_MAX)
    expect(list[0]).toEqual({ at: 1003, who: 'app', ev: 'step', detail: '3' })
    await clearPushLog(store)
    expect(await readPushLog(store)).toEqual([])
  })
  it('без кэша — пусто и тихо', async () => {
    await appendPushLog('x', '', undefined)
    expect(await readPushLog(undefined)).toEqual([])
  })
})

describe('push-sw.js (v8.9.6)', () => {
  it('версия обработчика пушей = версия приложения (поднять вместе с package.json)', () => {
    const sw = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8')
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(sw.match(/const PUSH_SW_VER = '([^']+)'/)?.[1]).toBe(pkg.version)
  })
})

describe('takeTappedPushUrl — нажатие у свернутой PWA (v8.9.6)', () => {
  const url = 'https://x.ru/app/?push=rest'
  function setup(entry, shown = []) {
    const map = new Map(entry ? [[LAST_PUSH_KEY, JSON.stringify(entry)]] : [])
    const cache = {
      match: async (k) => { const v = map.get(k); return v === undefined ? undefined : { json: async () => JSON.parse(v) } },
      delete: async (k) => map.delete(k),
    }
    const reg = { getNotifications: vi.fn(async () => shown) }
    return { store: { open: async () => cache }, map, reg }
  }
  it('уведомления в шторке уже нет — переход, запись снята', async () => {
    const { store, map, reg } = setup({ url, tag: 'rest', at: 1000 })
    expect(await takeTappedPushUrl(reg, 5000, store)).toBe(url)
    expect(reg.getNotifications).toHaveBeenCalledWith({ tag: 'rest' })
    expect(map.size).toBe(0)
  })
  it('уведомление еще висит — открыли сами, никуда не ведем, запись остается', async () => {
    const { store, map, reg } = setup({ url, tag: 'rest', at: 1000 }, [{}])
    expect(await takeTappedPushUrl(reg, 5000, store)).toBeNull()
    expect(map.size).toBe(1)
  })
  it('старый пуш — не ведем, запись снята; без getNotifications — не гадаем', async () => {
    const old = setup({ url, tag: 'rest', at: 0 })
    expect(await takeTappedPushUrl(old.reg, LAST_PUSH_TTL_MS + 1, old.store)).toBeNull()
    expect(old.map.size).toBe(0)
    const s = setup({ url, tag: 'rest', at: 1000 })
    expect(await takeTappedPushUrl({}, 5000, s.store)).toBeNull()
    expect(s.map.size).toBe(1)
  })
})
