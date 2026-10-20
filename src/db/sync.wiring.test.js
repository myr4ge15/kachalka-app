// Проводка синка (db/sync.js startSync): что запускает прогон (старт, «снова онлайн»,
// возврат в приложение, события сессии, сигнал Realtime), канал Realtime поднимается один
// раз и рвется на выходе, остановка гасит все; без PIN в памяти — понятная ошибка вместо
// тихого «синхронизировано». Стадии push/pull подменены (их держит sync.test.js), прогон
// виден по вызову hasSession — первой проверки runOnce (покрытие тестами 20.10.2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: false,
  events: {},
  authCb: null,
  channels: [],
  removed: [],
  unsubAuth: 0,
  canRefresh: false,
}))

vi.mock('./supabase.js', () => ({
  isConfigured: true,
  hasSession: vi.fn(async () => h.session),
  serverIdentity: vi.fn(async () => ({ known: true, id: 'me' })),
  supabase: {
    auth: {
      onAuthStateChange: (cb) => { h.authCb = cb; return { data: { subscription: { unsubscribe: () => { h.unsubAuth++ } } } } },
      signOut: vi.fn(async () => {}),
    },
    channel: () => {
      const ch = { handlers: [], status: null }
      ch.on = (_type, _filter, fn) => { ch.handlers.push(fn); return ch }
      ch.subscribe = (fn) => { ch.status = fn; return ch }
      h.channels.push(ch)
      return ch
    },
    removeChannel: (ch) => { h.removed.push(ch) },
  },
}))
vi.mock('./local.js', () => ({ db: {}, nowIso: () => '2026-10-20T10:00:00.000Z', setMeta: vi.fn(async () => {}) }))
vi.mock('./repo.js', () => ({ pendingCount: async () => 0, deadLetterCount: async () => 0 }))
vi.mock('./feed.js', () => ({ fetchFeed: vi.fn(async () => {}) }))
vi.mock('./sync/pull.js', () => ({ pull: vi.fn(async () => []), pullGoal: vi.fn(async () => {}), pullUserMeta: vi.fn(async () => {}) }))
vi.mock('./sync/push.js', () => ({
  push: vi.fn(async () => new Set()), pushExercises: vi.fn(async () => {}), pushTemplates: vi.fn(async () => []),
  pushReactions: vi.fn(async () => {}), pushGoal: vi.fn(async () => {}), pushUserMeta: vi.fn(async () => {}),
}))
vi.mock('../lib/auth.js', () => ({ canRefreshSilently: () => h.canRefresh, refreshSessionSilently: vi.fn(async () => false) }))
vi.mock('../lib/appEvents.js', () => {
  const on = (kind) => (fn) => { h.events[kind] = fn; return () => { delete h.events[kind] } }
  return { onOnline: on('online'), onOffline: on('offline'), onResume: on('resume') }
})

const { startSync, getSyncState } = await import('./sync.js')
const { hasSession } = await import('./supabase.js')
const { push } = await import('./sync/push.js')

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const runs = () => vi.mocked(hasSession).mock.calls.length

let stop
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(h, { session: false, events: {}, authCb: null, channels: [], removed: [], unsubAuth: 0, canRefresh: false })
  vi.stubGlobal('navigator', { onLine: true })
  vi.mocked(hasSession).mockClear()
  vi.mocked(push).mockClear()
})
afterEach(() => {
  stop?.()
  stop = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('startSync', () => {
  it('первый прогон сразу; «снова онлайн» и возврат в приложение — еще прогон', async () => {
    stop = startSync(() => 'me')
    await flush()
    expect(runs()).toBe(1)
    h.events.online()
    await flush()
    expect(runs()).toBe(2)
    expect(getSyncState().online).toBe(true)
    h.events.resume()
    await flush()
    expect(runs()).toBe(3)
    h.events.offline()
    expect(getSyncState().online).toBe(false)
  })

  it('без сессии и без PIN в памяти — прямая ошибка «выйди и войди», не «синхронизировано»', async () => {
    stop = startSync(() => 'me')
    await flush()
    expect(getSyncState()).toMatchObject({ netError: true, lastError: expect.stringMatching(/выйди и войди по PIN/) })
    expect(push).not.toHaveBeenCalled()
  })

  it('сессия есть — прогон доходит до push и ставит метку синка', async () => {
    h.session = true
    stop = startSync(() => 'me')
    await vi.waitFor(() => expect(getSyncState().lastSyncAt).toBe('2026-10-20T10:00:00.000Z'))
    expect(push).toHaveBeenCalled()
    expect(getSyncState()).toMatchObject({ netError: false, lastError: null, syncing: false })
  })

  it('события сессии: вход поднимает канал Realtime один раз, выход рвет', async () => {
    stop = startSync(() => 'me')
    await flush()
    const before = runs()
    h.authCb('SIGNED_IN', { user: {} })
    h.authCb('TOKEN_REFRESHED', { user: {} })
    await flush()
    // Второй вызов во время прогона не идет параллельно (заказывает повтор) — хотя бы один прогон.
    expect(runs()).toBeGreaterThan(before)
    expect(h.channels).toHaveLength(1)
    h.authCb('SIGNED_OUT', null)
    expect(h.removed).toEqual([h.channels[0]])
    h.authCb('INITIAL_SESSION', null) // без сессии канал не поднимаем
    expect(h.channels).toHaveLength(1)
  })

  it('сигнал Realtime — прогон с задержкой (дебаунс), несколько сигналов — один прогон', async () => {
    stop = startSync(() => 'me')
    await flush()
    h.authCb('SIGNED_IN', { user: {} })
    await flush()
    const before = runs()
    const [onWorkouts, onGoals] = h.channels[0].handlers
    onWorkouts(); onGoals(); onWorkouts()
    expect(runs()).toBe(before)
    await vi.advanceTimersByTimeAsync(5000)
    expect(runs()).toBe(before + 1)
    h.channels[0].status('SUBSCRIBED') // живой канал — реже опрос, без падений
  })

  it('поллинг: без событий прогоны идут сами по таймеру', async () => {
    stop = startSync(() => 'me')
    await flush()
    const before = runs()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(runs()).toBeGreaterThan(before)
  })

  it('остановка: отписка от событий и сессии, канал закрыт, таймер стоит', async () => {
    stop = startSync(() => 'me')
    await flush()
    h.authCb('SIGNED_IN', { user: {} })
    await flush()
    stop()
    stop = null
    expect(h.events).toEqual({})
    expect(h.unsubAuth).toBe(1)
    expect(h.removed).toEqual([h.channels[0]])
    const before = runs()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(runs()).toBe(before)
  })
})
