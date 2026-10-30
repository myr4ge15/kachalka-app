// lib/pushIntent.js — края перехода по пушу (покрытие веток, 30.10.2026): мусорные и чужие значения
// не открывают экран и ничего не роняют, запись о нажатии одноразовая, журнал и диагностика SW
// переживают сбои. Основной путь — pushIntent.test.js. Здесь кэш — настоящие Response в памяти.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendPushLog, clearPushLog, diagnoseServiceWorkers, LAST_PUSH_KEY, LAST_PUSH_TTL_MS, onPushOpen, PENDING_TTL_MS,
  PUSH_INTENT_KEY, PUSH_LOG_MAX, PUSH_LOG_PREFIX, pushIntentFromTag, pushIntentFromUrl, readPushLog, startPushListener,
  stripPushParam, takePendingPushUrl, takeTappedPushUrl,
} from './pushIntent.js'

const W = '3f2c9a1e-0b4d-4c7e-9a10-5e6f7a8b9c0d'
const U = 'aa11bb22-cc33-4d44-8e55-66ff77889900'

function memCaches(seed = {}) {
  const map = new Map()
  const norm = (k) => new URL(k, 'https://x.ru').href
  for (const [k, v] of Object.entries(seed)) map.set(norm(k), typeof v === 'string' ? v : JSON.stringify(v))
  const cache = {
    match: vi.fn(async (k) => { const v = map.get(norm(k)); return v === undefined ? undefined : new Response(v) }),
    put: vi.fn(async (k, res) => { map.set(norm(k), await res.text()) }),
    delete: vi.fn(async (k) => map.delete(norm(k))),
    keys: vi.fn(async () => [...map.keys()].map((url) => ({ url }))),
  }
  return { open: vi.fn(async () => cache), cache, map, has: (k) => map.has(norm(k)) }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('разбор tag', () => {
  it.each([
    ['число', 42], ['undefined', undefined], ['объект', { tag: 'update' }], ['массив', ['update']],
    ['регистр служебного tag', 'UPDATE'], ['пробел', ' rest'], ['хвост', 'update\n'],
    ['реакция без автора', `reaction-${W}`], ['комментарий без автора', `comment-${W}`],
    ['префикс перед типом', `xreaction-${W}-${U}`], ['чужой тип с uuid', `workout-${W}-${U}`],
    ['обращение с переводом строки', `feedback-${W}\n`], ['неполный uuid', `feedback-${W.slice(0, -1)}`],
    ['не hex в uuid', `reaction-${W.replace('3', 'z')}-${U}`],
    ['друг без события', `friend-${U}`], ['друг с коротким id', 'friend-accepted-123'],
    ['ссылка вместо tag', 'https://evil.example/'],
  ])('%s — без намерения', (_name, tag) => {
    expect(pushIntentFromTag(tag)).toBeNull()
  })

  it('регистр в tag «Друзей» не важен, повторный разбор стабилен (у regexp нет состояния)', () => {
    const tag = `FRIEND-REQUEST-${U}`
    expect(pushIntentFromTag(tag)).toEqual({ type: 'friend' })
    expect(pushIntentFromTag(tag)).toEqual({ type: 'friend' })
  })

  it('комментарий приводит id к нижнему регистру', () => {
    expect(pushIntentFromTag(`comment-${W.toUpperCase()}-${U}`)).toEqual({ type: 'comment', workoutId: W })
  })
})

describe('разбор адреса', () => {
  it.each([
    ['пустой параметр', 'https://x.ru/?push='],
    ['мусор в параметре', 'https://x.ru/?push=%00%FF'],
    ['чужой параметр', 'https://x.ru/?pushed=update'],
    ['tag в якоре, а не в запросе', 'https://x.ru/#push=update'],
    ['относительный адрес', '/app/?push=update'],
    ['null', null], ['undefined', undefined], ['число', 7],
  ])('%s — без намерения', (_name, href) => {
    expect(pushIntentFromUrl(href)).toBeNull()
  })

  it('из нескольких push берется первый, кодировка tag разбирается', () => {
    expect(pushIntentFromUrl('https://x.ru/?push=rest&push=update')).toEqual({ type: 'rest' })
    expect(pushIntentFromUrl(`https://x.ru/?push=feedback%2D${W}`)).toEqual({ type: 'feedback', feedbackId: W })
  })

  it('stripPushParam: мусор — null, все значения push снимаются, якорь с токеном цел', () => {
    expect(stripPushParam('не адрес')).toBeNull()
    expect(stripPushParam(undefined)).toBeNull()
    expect(stripPushParam('https://x.ru/app/?push=a&push=b&c=1#reset=tok')).toBe('/app/?c=1#reset=tok')
  })
})

describe('запись о нажатии (takePendingPushUrl)', () => {
  const url = 'https://x.ru/?push=rest'

  it('срок: ровно на границе берем, позже и из будущего — нет', async () => {
    expect(await takePendingPushUrl(1000 + PENDING_TTL_MS, memCaches({ [PUSH_INTENT_KEY]: { url, at: 1000 } }))).toBe(url)
    expect(await takePendingPushUrl(1000 + PENDING_TTL_MS + 1, memCaches({ [PUSH_INTENT_KEY]: { url, at: 1000 } }))).toBeNull()
    const future = memCaches({ [PUSH_INTENT_KEY]: { url, at: 5000 } })
    expect(await takePendingPushUrl(4999, future)).toBeNull()
    expect(future.has(PUSH_INTENT_KEY)).toBe(false)
  })

  it.each([
    ['битый JSON', 'не json'],
    ['null', 'null'],
    ['время не число', { url, at: 'вчера' }],
    ['нет времени', { url }],
  ])('%s: переход не открывается, запись не остается', async (_name, value) => {
    const store = memCaches({ [PUSH_INTENT_KEY]: value })
    expect(await takePendingPushUrl(1000, store)).toBeNull()
    expect(store.has(PUSH_INTENT_KEY)).toBe(false)
  })

  it('сбой Cache Storage — null, а не исключение', async () => {
    expect(await takePendingPushUrl(1, { open: async () => { throw new Error('quota') } })).toBeNull()
  })

  it('настоящий кэш приложения: в журнал уходит и переход, и отброшенная запись', async () => {
    const store = memCaches({ [PUSH_INTENT_KEY]: { url, at: 1000 } })
    vi.stubGlobal('caches', store)
    expect(await takePendingPushUrl(2000)).toBe(url)
    await vi.waitFor(async () => expect((await readPushLog()).at(-1)).toMatchObject({ ev: 'take', detail: url }))

    store.map.set(new URL(PUSH_INTENT_KEY, 'https://x.ru').href, JSON.stringify({ url, at: 0 }))
    expect(await takePendingPushUrl(10_000_000)).toBeNull()
    await vi.waitFor(async () => {
      expect((await readPushLog()).map((r) => r.detail)).toContainEqual(expect.stringMatching(/старая запись \(10000 с\)/))
    })
  })
})

describe('нажатие у свернутой PWA (takeTappedPushUrl)', () => {
  const url = 'https://x.ru/?push=rest'
  const reg = (shown = []) => ({ getNotifications: vi.fn(async () => shown) })

  it('нет кэша или регистрации — не гадаем', async () => {
    expect(await takeTappedPushUrl(reg(), 1, undefined)).toBeNull()
    expect(await takeTappedPushUrl(null, 1, memCaches())).toBeNull()
  })

  it('записи нет — шторку не спрашиваем', async () => {
    const r = reg()
    expect(await takeTappedPushUrl(r, 1, memCaches())).toBeNull()
    expect(r.getNotifications).not.toHaveBeenCalled()
  })

  it('пуш без tag: спрашиваем всю шторку', async () => {
    const r = reg()
    const store = memCaches({ [LAST_PUSH_KEY]: { url, at: 1000 } })
    expect(await takeTappedPushUrl(r, 2000, store)).toBe(url)
    expect(r.getNotifications).toHaveBeenCalledWith(undefined)
  })

  it.each([
    ['из будущего', { url, tag: 'rest', at: 5000 }, 4000],
    ['адрес не строка', { url: 5, tag: 'rest', at: 1000 }, 2000],
    ['время не число', { url, tag: 'rest', at: null }, 2000],
    ['ровно за сроком', { url, tag: 'rest', at: 0 }, LAST_PUSH_TTL_MS + 1],
  ])('%s: не ведем, запись снята, шторку не трогаем', async (_name, entry, now) => {
    const r = reg()
    const store = memCaches({ [LAST_PUSH_KEY]: entry })
    expect(await takeTappedPushUrl(r, now, store)).toBeNull()
    expect(store.has(LAST_PUSH_KEY)).toBe(false)
    expect(r.getNotifications).not.toHaveBeenCalled()
  })

  it('битая запись и сбой шторки — null без исключения', async () => {
    expect(await takeTappedPushUrl(reg(), 1, memCaches({ [LAST_PUSH_KEY]: 'не json' }))).toBeNull()
    const failing = { getNotifications: async () => { throw new Error('denied') } }
    const store = memCaches({ [LAST_PUSH_KEY]: { url, tag: 'rest', at: 1000 } })
    expect(await takeTappedPushUrl(failing, 2000, store)).toBeNull()
    expect(store.has(LAST_PUSH_KEY)).toBe(true) // не поняли — нажатие не считаем обработанным
  })

  it('настоящий кэш приложения: журнал различает «еще в шторке» и «нажали»', async () => {
    const store = memCaches({ [LAST_PUSH_KEY]: { url, tag: 'rest', at: 1000 } })
    vi.stubGlobal('caches', store)
    expect(await takeTappedPushUrl(reg([{}]), 2000)).toBeNull()
    await vi.waitFor(async () => expect((await readPushLog()).at(-1)).toMatchObject({ ev: 'last', detail: expect.stringContaining('rest') }))
    expect(await takeTappedPushUrl(reg(), 2000)).toBe(url)
    await vi.waitFor(async () => expect((await readPushLog()).map((r) => r.ev)).toContain('tapped'))
  })
})

describe('журнал: края', () => {
  it('детали: пусто вместо null, длинное обрезается до 160', async () => {
    const store = memCaches()
    await appendPushLog('a', null, store, 1)
    await appendPushLog('b', 'я'.repeat(500), store, 2)
    const rows = await readPushLog(store)
    expect(rows[0].detail).toBe('')
    expect(rows[1].detail).toHaveLength(160)
  })

  it('сбой записи и чистки приложению не мешает', async () => {
    const broken = { open: async () => { throw new Error('quota') } }
    await expect(appendPushLog('x', '', broken)).resolves.toBeUndefined()
    await expect(clearPushLog(broken)).resolves.toBeUndefined()
    await expect(clearPushLog(undefined)).resolves.toBeUndefined()
  })

  it('чтение: битая строка пропускается, остальные по времени', async () => {
    const store = memCaches({
      [`${PUSH_LOG_PREFIX}20-a`]: { at: 20, ev: 'b' },
      [`${PUSH_LOG_PREFIX}15-x`]: 'не json',
      [`${PUSH_LOG_PREFIX}10-b`]: { at: 10, ev: 'a' },
    })
    expect((await readPushLog(store)).map((r) => r.ev)).toEqual(['a', 'b'])
  })

  it('строка исчезла между keys и match (подрезал SW) — не ошибка', async () => {
    const store = memCaches({ [`${PUSH_LOG_PREFIX}10-a`]: { at: 10, ev: 'a' } })
    store.cache.match.mockResolvedValueOnce(undefined)
    expect(await readPushLog(store)).toEqual([])
  })

  it('сбой чтения без message — строка error с текстом причины', async () => {
    const rows = await readPushLog({ open: async () => { throw 'нет доступа' } })
    expect(rows).toEqual([expect.objectContaining({ ev: 'error', who: 'app', detail: expect.stringContaining('нет доступа') })])
  })

  it('ключи-строки и ключи без времени: подрезка убирает сначала не датированные', async () => {
    const store = memCaches()
    const keys = [`${PUSH_LOG_PREFIX}мусор`, ...Array.from({ length: PUSH_LOG_MAX }, (_, i) => `${PUSH_LOG_PREFIX}${1000 + i}-a`)]
    store.cache.keys.mockImplementation(async () => [...store.map.keys()])
    for (const k of keys) store.map.set(new URL(k, 'https://x.ru').href, JSON.stringify({ at: 1 }))
    await appendPushLog('new', '', store, 5000)
    expect(store.map.size).toBe(PUSH_LOG_MAX)
    expect(store.has(keys[0])).toBe(false)
    expect(store.has(keys[1])).toBe(false)
    expect(store.has(keys[2])).toBe(true)
  })
})

describe('диагностика service worker', () => {
  const answering = (scriptURL, reply) => ({
    scriptURL,
    postMessage: (msg, [port]) => {
      expect(msg).toEqual({ type: 'push-sw-ping' })
      port.postMessage(reply)
      setTimeout(() => port.close(), 0)
    },
  })

  it('нет API — пустой список', async () => {
    expect(await diagnoseServiceWorkers(undefined)).toEqual([])
    expect(await diagnoseServiceWorkers({})).toEqual([])
  })

  it('активный SW: версия из ответа, подписка — только хвост, управляет страницей', async () => {
    const worker = answering('https://x.ru/sw.js', { ver: '1.6.0' })
    const endpoint = 'https://push.example/1234567890abcdefXYZ'
    const reg = { scope: 'https://x.ru/', active: worker, pushManager: { getSubscription: async () => ({ endpoint }) } }
    const [row] = await diagnoseServiceWorkers({ getRegistrations: async () => [reg], controller: { scriptURL: 'https://x.ru/sw.js' } })
    expect(row).toEqual({
      scope: 'https://x.ru/', script: 'https://x.ru/sw.js', state: 'active', waiting: false, controls: true,
      sub: '…4567890abcdefXYZ', ver: '1.6.0',
    })
  })

  it('старый SW отвечает без версии — «?»; страницей управляет другой', async () => {
    const reg = { scope: 's', active: answering('https://x.ru/old.js', {}) }
    const [row] = await diagnoseServiceWorkers({ getRegistrations: async () => [reg], controller: { scriptURL: 'https://x.ru/new.js' } })
    expect(row).toMatchObject({ ver: '?', controls: false, sub: null })
  })

  it('SW молчит — через 1,5 с версия null, остальное показывается', async () => {
    vi.useFakeTimers()
    const silent = { scriptURL: 'u', postMessage: (_m, [port]) => port.close() }
    const p = diagnoseServiceWorkers({ getRegistrations: async () => [{ scope: 's', active: silent }] })
    await vi.advanceTimersByTimeAsync(1500)
    expect((await p)[0]).toMatchObject({ state: 'active', ver: null })
  })

  it('postMessage упал — версия null сразу, без ожидания таймера', async () => {
    const worker = { scriptURL: 'u', postMessage: () => { throw new Error('detached') } }
    const [row] = await diagnoseServiceWorkers({ getRegistrations: async () => [{ scope: 's', active: worker }] })
    expect(row.ver).toBeNull()
  })

  it('ждущий, устанавливаемый, пустая регистрация; сбой подписки не ломает строку', async () => {
    const regs = [
      { scope: 'w', waiting: { scriptURL: 'w.js' }, pushManager: { getSubscription: async () => { throw new Error('denied') } } },
      { scope: 'i', installing: { scriptURL: 'i.js' }, pushManager: { getSubscription: async () => null } },
      { scope: 'n' },
    ]
    const rows = await diagnoseServiceWorkers({ getRegistrations: async () => regs })
    expect(rows.map((r) => [r.state, r.script, r.waiting, r.controls, r.sub, r.ver])).toEqual([
      ['waiting', 'w.js', true, false, null, null],
      ['installing', 'i.js', false, false, null, null],
      ['нет', '', false, false, null, null],
    ])
  })
})

describe('слушатель пушей: края', () => {
  function fakeSw(extra = {}) {
    const handlers = new Set()
    return {
      addEventListener: (_t, fn) => handlers.add(fn),
      removeEventListener: (_t, fn) => handlers.delete(fn),
      emit: (e) => { for (const fn of handlers) fn(e) },
      ...extra,
    }
  }

  it('без service worker отписка — безобидная функция', () => {
    expect(startPushListener(undefined)()).toBeUndefined()
  })

  it('чужие сообщения не отвечают SW и не становятся переходом; Safari без startMessages не падает', () => {
    const sw = fakeSw()
    const stop = startPushListener(sw)
    const port = { postMessage: vi.fn() }
    sw.emit({ data: null, ports: [port] })
    sw.emit({ data: { type: 'SKIP_WAITING', url: 'https://evil.example/' }, ports: [port] })
    sw.emit({})
    expect(port.postMessage).not.toHaveBeenCalled()
    const got = []
    const off = onPushOpen((u) => got.push(u))
    expect(got).toEqual([])
    off(); stop()
  })

  it('адрес получают все подписчики, отписавшийся — нет; после stop сообщения не идут', () => {
    const sw = fakeSw()
    const stop = startPushListener(sw)
    const a = []
    const b = []
    const offA = onPushOpen((u) => a.push(u))
    const offB = onPushOpen((u) => b.push(u))
    sw.emit({ data: { type: 'push-open', url: 'u1' } }) // без портов: старый SW
    offA()
    sw.emit({ data: { type: 'push-open', url: 'u2' } })
    stop()
    sw.emit({ data: { type: 'push-open', url: 'u3' } })
    offB()
    expect(a).toEqual(['u1'])
    expect(b).toEqual(['u1', 'u2'])
  })

  it('адрес до подписки отдается один раз — первому подписчику', () => {
    const sw = fakeSw()
    const stop = startPushListener(sw)
    sw.emit({ data: { type: 'push-open', url: 'early' } })
    const a = []
    const b = []
    const offA = onPushOpen((u) => a.push(u))
    const offB = onPushOpen((u) => b.push(u))
    expect(a).toEqual(['early'])
    expect(b).toEqual([])
    offA(); offB(); stop()
  })

  it('дошедшее сообщение снимает запись в кэше: второго перехода не будет', async () => {
    const store = memCaches({ [PUSH_INTENT_KEY]: { url: 'u1', at: Date.now() } })
    vi.stubGlobal('caches', store)
    const sw = fakeSw()
    const stop = startPushListener(sw)
    const off = onPushOpen(() => {})
    sw.emit({ data: { type: 'push-open', url: 'u1' } })
    await vi.waitFor(() => expect(store.has(PUSH_INTENT_KEY)).toBe(false))
    await vi.waitFor(async () => expect((await readPushLog()).map((r) => r.ev)).toContain('message'))
    off(); stop()
  })
})
