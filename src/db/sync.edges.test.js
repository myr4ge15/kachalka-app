// @vitest-environment jsdom
// Края оркестратора syncNow/startSync: порядок стадий (FK), какие сбои роняют прогон, а какие
// дают только предупреждение, поколения состояния при смене учетки, статус для шапки. Стадии
// push/pull подменены — их поведение держат pull.test.js, pull.edges.test.js и sync.test.js;
// здесь важно только, что оркестратор делает с их результатом (покрытие веток, 30.10.2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  configured: true,
  session: true,
  gate: null, // промис, которого ждет hasSession (прогон «на сетевом await»)
  identity: { known: true, id: 'me' },
  canRefresh: false,
  order: [],
  authCb: null,
  channels: [],
  removed: [],
  events: {},
}))

// Живой запрос Dexie без IndexedDB не стартует: достаточно, что хук спросил нужные счетчики.
vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useState } = await import('react')
  return {
    useLiveQuery: (query, _deps, initial) => {
      const [value, setValue] = useState(initial)
      useEffect(() => { query().then(setValue) }, []) // eslint-disable-line react-hooks/exhaustive-deps
      return value
    },
  }
})

vi.mock('./supabase.js', () => ({
  get isConfigured() { return h.configured },
  hasSession: vi.fn(async () => { if (h.gate) await h.gate; return h.session }),
  serverIdentity: vi.fn(async () => h.identity),
  supabase: {
    auth: {
      onAuthStateChange: (cb) => { h.authCb = cb; return { data: { subscription: { unsubscribe() {} } } } },
      signOut: vi.fn(async () => {}),
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch }
      h.channels.push(ch)
      return ch
    },
    removeChannel: (ch) => { h.removed.push(ch) },
  },
}))
vi.mock('./local.js', () => ({ db: {}, nowIso: () => '2026-10-30T10:00:00.000Z', setMeta: vi.fn(async () => {}) }))
vi.mock('./repo.js', () => ({ pendingCount: vi.fn(async () => 3), deadLetterCount: vi.fn(async () => 1) }))
vi.mock('./feed.js', () => ({ fetchFeed: vi.fn(async () => {}) }))
vi.mock('./sync/pull.js', () => ({ pull: vi.fn(), pullGoal: vi.fn(), pullUserMeta: vi.fn() }))
vi.mock('./sync/push.js', () => ({
  push: vi.fn(), pushExercises: vi.fn(), pushTemplates: vi.fn(), pushReactions: vi.fn(), pushGoal: vi.fn(), pushUserMeta: vi.fn(),
}))
vi.mock('../lib/auth.js', () => ({ canRefreshSilently: () => h.canRefresh, refreshSessionSilently: vi.fn(async () => false) }))
vi.mock('../lib/appEvents.js', () => {
  const on = (kind) => (fn) => { h.events[kind] = fn; return () => { delete h.events[kind] } }
  return { onOnline: on('online'), onOffline: on('offline'), onResume: on('resume') }
})

import { syncNow, startSync, getSyncState, useSyncStatus } from './sync.js'
import { hasSession, supabase } from './supabase.js'
import { setMeta } from './local.js'
import { fetchFeed } from './feed.js'
import { pull, pullGoal, pullUserMeta } from './sync/pull.js'
import { push, pushExercises, pushTemplates, pushReactions, pushGoal, pushUserMeta } from './sync/push.js'

const STAGES = { pushExercises, pushTemplates, push, pushReactions, pushGoal, pull, pullGoal, pullUserMeta, pushUserMeta, fetchFeed }
const AT = '2026-10-30T10:00:00.000Z'

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

let stops = []
const start = (id = 'me') => {
  const stop = startSync(() => id)
  stops.push(stop)
  return stop
}

beforeEach(() => {
  Object.assign(h, {
    configured: true, session: true, gate: null, identity: { known: true, id: 'me' },
    canRefresh: false, order: [], authCb: null, channels: [], removed: [], events: {},
  })
  for (const [name, fn] of Object.entries(STAGES)) {
    vi.mocked(fn).mockReset()
    vi.mocked(fn).mockImplementation(async () => { h.order.push(name) })
  }
  vi.mocked(push).mockImplementation(async () => { h.order.push('push'); return new Set(['w1']) })
  vi.mocked(pushTemplates).mockImplementation(async () => { h.order.push('pushTemplates'); return [] })
  vi.mocked(pull).mockImplementation(async () => { h.order.push('pull'); return [] })
  vi.mocked(hasSession).mockClear()
  vi.mocked(setMeta).mockClear()
  vi.mocked(supabase.auth.signOut).mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  stops.forEach((s) => s())
  stops = []
  vi.restoreAllMocks()
})

describe('syncNow: когда прогона нет', () => {
  it.each([
    ['бэкенд не настроен', () => { h.configured = false }, 'me'],
    ['офлайн', () => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false) }, 'me'],
    ['нет учетки', () => {}, null],
  ])('%s: ни одной стадии и ни одного запроса', async (_name, arrange, id) => {
    arrange()
    expect(await syncNow(id)).toBeUndefined()
    expect(hasSession).not.toHaveBeenCalled()
    expect(h.order).toEqual([])
  })
})

describe('syncNow: порядок стадий', () => {
  it('упражнения → шаблоны → тренировки → реакции → цель, потом pull со списком отправленных', async () => {
    expect(await syncNow('me')).toBe(true)

    expect(h.order).toEqual([
      'pushExercises', 'pushTemplates', 'push', 'pushReactions', 'pushGoal',
      'pull', 'pullGoal', 'pushGoal', 'pullUserMeta', 'pushUserMeta', 'fetchFeed',
    ])
    const [userId, justPushed, , opts] = vi.mocked(pull).mock.calls[0]
    expect(userId).toBe('me')
    expect(justPushed).toEqual(new Set(['w1']))
    expect(opts).toEqual({ identityVerified: true })
    expect(setMeta).toHaveBeenCalledWith('lastSyncAt', AT, expect.anything())
  })

  it('личность не проверена: прогон идет, но pull не верит пустым ответам', async () => {
    h.identity = { known: false, id: null }
    expect(await syncNow('me')).toBe(true)
    expect(vi.mocked(pull).mock.calls[0][3]).toEqual({ identityVerified: false })
  })

  it('числовой id учетки сверяется со строковым ответом сервера', async () => {
    h.identity = { known: true, id: '42' }
    expect(await syncNow(42)).toBe(true)
  })
})

describe('syncNow: чужая сессия', () => {
  it('ни одной стадии, ошибка в шапке; сбой локального выхода не меняет исход', async () => {
    h.identity = { known: true, id: null }
    vi.mocked(supabase.auth.signOut).mockRejectedValue(new Error('уже вышли'))

    expect(await syncNow('me')).toBe(false)

    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(h.order).toEqual([])
    expect(getSyncState()).toMatchObject({ lastError: 'Сессия завершена на сервере — войди заново', netError: true, syncing: false })
  })
})

describe('syncNow: необязательные стадии не роняют прогон', () => {
  it('сбой реакций и ленты молчит: прогон успешен, ошибок нет', async () => {
    vi.mocked(pushReactions).mockRejectedValue(new Error('нет таблицы'))
    vi.mocked(fetchFeed).mockRejectedValue(new Error('лента легла'))

    expect(await syncNow('me')).toBe(true)

    expect(getSyncState()).toMatchObject({ lastError: null, netError: false, lastSyncAt: AT })
  })

  it('первый pushGoal упал: pull тренировок все равно идет, причина видна, netError нет', async () => {
    vi.mocked(pushGoal).mockRejectedValueOnce(new Error('нет RPC'))

    expect(await syncNow('me')).toBe(true)

    expect(pull).toHaveBeenCalled()
    expect(getSyncState()).toMatchObject({ lastError: 'цель не отправлена: нет RPC', netError: false, lastSyncAt: AT })
  })

  it('упал pullGoal: тот же текст, личные настройки и лента все равно идут', async () => {
    vi.mocked(pullGoal).mockRejectedValue('goals down') // не Error

    expect(await syncNow('me')).toBe(true)

    expect(pullUserMeta).toHaveBeenCalled()
    expect(fetchFeed).toHaveBeenCalled()
    expect(getSyncState().lastError).toBe('цель не отправлена: goals down')
  })

  it('два сбоя цели подряд: показана первая причина, а не последняя', async () => {
    vi.mocked(pushGoal).mockRejectedValueOnce(new Error('первая'))
    vi.mocked(pullGoal).mockRejectedValue(new Error('вторая'))

    await syncNow('me')

    expect(getSyncState().lastError).toBe('цель не отправлена: первая')
  })

  it.each([
    ['pullUserMeta', pullUserMeta],
    ['pushUserMeta', pushUserMeta],
  ])('упал %s: настройки в предупреждении, метка синка обновлена', async (_name, stage) => {
    vi.mocked(stage).mockRejectedValue(new Error('unknown user_meta key'))

    expect(await syncNow('me')).toBe(true)

    expect(getSyncState()).toMatchObject({
      lastError: 'настройки не отправлены: unknown user_meta key', netError: false, lastSyncAt: AT,
    })
  })

  it('предупреждения всех стадий собираются в одну строку', async () => {
    vi.mocked(pushTemplates).mockResolvedValue(['шаблон ждет сервер'])
    vi.mocked(pull).mockResolvedValue(['упражнения: сбой'])
    vi.mocked(pushGoal).mockRejectedValueOnce(new Error('цель'))
    vi.mocked(pushUserMeta).mockRejectedValue(new Error('мета'))

    expect(await syncNow('me')).toBe(true)

    expect(getSyncState().lastError).toBe(
      'шаблон ждет сервер; упражнения: сбой; цель не отправлена: цель; настройки не отправлены: мета',
    )
  })

  it('стадии без списка предупреждений — чистый успех', async () => {
    vi.mocked(pushTemplates).mockResolvedValue(undefined)
    vi.mocked(pull).mockResolvedValue(undefined)

    expect(await syncNow('me')).toBe(true)

    expect(getSyncState()).toMatchObject({ lastError: null, netError: false })
  })
})

describe('syncNow: критичные сбои', () => {
  it.each([
    ['pushExercises', pushExercises],
    ['push', push],
    ['pull', pull],
  ])('%s упал: netError, false для backoff, метка не ставится, индикатор снят', async (_name, stage) => {
    vi.mocked(stage).mockRejectedValue(new Error('Failed to fetch'))
    vi.mocked(setMeta).mockClear()

    expect(await syncNow('me')).toBe(false)

    expect(getSyncState()).toMatchObject({ lastError: 'Failed to fetch', netError: true, syncing: false })
    expect(setMeta).not.toHaveBeenCalled()
  })

  it('упал push тренировок: pull не запускается поверх неотправленной очереди', async () => {
    vi.mocked(push).mockRejectedValue(new Error('5xx'))
    await syncNow('me')
    expect(pull).not.toHaveBeenCalled()
  })

  it('бросок не Error тоже попадает в шапку', async () => {
    vi.mocked(pull).mockRejectedValue('нет сети')
    expect(await syncNow('me')).toBe(false)
    expect(getSyncState()).toMatchObject({ lastError: 'нет сети', netError: true })
  })

  it('следующий успешный прогон снимает netError', async () => {
    vi.mocked(pull).mockRejectedValueOnce(new Error('сеть'))
    await syncNow('me')
    expect(getSyncState().netError).toBe(true)

    expect(await syncNow('me')).toBe(true)
    expect(getSyncState()).toMatchObject({ lastError: null, netError: false })
  })
})

describe('поколения состояния: смена учетки посреди прогона', () => {
  // Прогон учетки A дошел до pull и ждет сеть; в этот момент стартует синк учетки B.
  async function runStuckInPull(finish) {
    const net = deferred()
    vi.mocked(pull).mockImplementation(async () => { await net.promise; return finish() })
    const run = syncNow('a')
    await vi.waitFor(() => expect(pull).toHaveBeenCalled())
    start('b')
    net.resolve()
    return run
  }

  it('ошибка прогона прежней учетки не попадает в шапку новой, индикатор снимается', async () => {
    h.identity = { known: false, id: null }

    await runStuckInPull(() => { throw new Error('ошибка учетки A') })

    expect(getSyncState()).toMatchObject({ lastError: null, netError: false, syncing: false })
  })

  it('метка синка прежней учетки тоже не попадает', async () => {
    h.identity = { known: false, id: null }

    await runStuckInPull(() => ['предупреждение учетки A'])

    expect(getSyncState()).toMatchObject({ lastError: null, lastSyncAt: null })
  })

  it('отказ сервера в сессии прежней учетки не попадает в шапку новой', async () => {
    const net = deferred()
    h.gate = net.promise
    h.identity = { known: true, id: 'stranger' }
    const run = syncNow('a')
    await vi.waitFor(() => expect(hasSession).toHaveBeenCalled())
    start('b')
    h.gate = null
    net.resolve()
    await run

    expect(getSyncState()).toMatchObject({ lastError: null, netError: false })
  })

  it('«нет входа» прежней учетки не попадает в шапку новой', async () => {
    const net = deferred()
    h.gate = net.promise
    h.session = false
    const run = syncNow('a')
    await vi.waitFor(() => expect(hasSession).toHaveBeenCalled())
    start('b')
    h.gate = null
    net.resolve()
    await run

    expect(getSyncState()).toMatchObject({ lastError: null, netError: false })
  })
})

describe('startSync: края жизненного цикла', () => {
  it('прогон, ждавший ответа в момент остановки, таймер заново не заводит', async () => {
    vi.useFakeTimers()
    try {
      const stop = startSync(() => 'me')
      await vi.advanceTimersByTimeAsync(0) // первый прогон завершен
      const net = deferred()
      h.gate = net.promise
      await vi.advanceTimersByTimeAsync(20_000) // tick по таймеру повис на сети
      const runsAtStop = vi.mocked(hasSession).mock.calls.length
      expect(runsAtStop).toBeGreaterThanOrEqual(2)
      stop()
      h.gate = null
      net.resolve()
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(vi.mocked(hasSession).mock.calls.length).toBe(runsAtStop)
    } finally {
      vi.useRealTimers()
    }
  })

  it('выход без поднятого канала не падает и ничего не закрывает; посторонние события игнорируются', async () => {
    start()
    await vi.waitFor(() => expect(getSyncState().syncing).toBe(false))
    await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalled())
    const runs = vi.mocked(hasSession).mock.calls.length

    h.authCb('SIGNED_OUT', null)
    h.authCb('USER_UPDATED', { user: {} })
    await Promise.resolve()

    expect(h.removed).toEqual([])
    expect(h.channels).toEqual([])
    expect(vi.mocked(hasSession).mock.calls.length).toBe(runs)
  })

  it('остановка без поднятого канала не трогает removeChannel', async () => {
    const stop = start()
    stop()
    expect(h.removed).toEqual([])
  })
})

describe('useSyncStatus', () => {
  it('отдает очередь, застрявшие и живое состояние; после размонтирования не подписан', async () => {
    const repo = await import('./repo.js')
    vi.mocked(repo.pendingCount).mockResolvedValue(3)
    vi.mocked(repo.deadLetterCount).mockResolvedValue(1)

    const { result, unmount } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current).toMatchObject({ pending: 3, dead: 1 }))

    vi.mocked(pull).mockRejectedValueOnce(new Error('сеть'))
    await act(async () => { await syncNow('me') })
    expect(result.current).toMatchObject({ lastError: 'сеть', netError: true })

    const seen = result.current
    unmount()
    await syncNow('me')
    expect(result.current).toBe(seen)
    expect(getSyncState().netError).toBe(false)
  })

  it('пустые ответы счетчиков — нули, а не undefined', async () => {
    const repo = await import('./repo.js')
    vi.mocked(repo.pendingCount).mockClear()
    vi.mocked(repo.deadLetterCount).mockClear()
    vi.mocked(repo.pendingCount).mockResolvedValue(undefined)
    vi.mocked(repo.deadLetterCount).mockResolvedValue(null)

    const { result } = renderHook(() => useSyncStatus())

    await waitFor(() => expect(repo.deadLetterCount).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current).toMatchObject({ pending: 0, dead: 0 })
  })
})
