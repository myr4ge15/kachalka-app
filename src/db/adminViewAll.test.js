// «Видеть всех» — снимок режима в meta и чистка (27.10.2026): включение пишет снимок и синкает, выключение и
// конец срока чистят снимки профилей и метку Ленты (прочий meta цел), сверка без сети снимок не трогает.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), state: vi.fn(), sync: vi.fn() }))
vi.mock('./supabase.js', () => ({ isConfigured: true, hasSession: vi.fn(async () => true), supabase: {} }))
vi.mock('./sync.js', () => ({ syncNow: (...a) => api.sync(...a) }))
vi.mock('../lib/adminViewAll.js', () => ({
  viewAllOn: (...a) => api.on(...a), viewAllOff: (...a) => api.off(...a), viewAllState: (...a) => api.state(...a),
}))
import { openUserDb, closeUserDb, getMeta, setMeta } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { FEED_SIG } from './feed.js'
import { VIEW_ALL_KEY } from '../lib/viewAll.js'
import { enableViewAll, disableViewAll, refreshViewAll, getViewAll, resetViewAllCaches } from './adminViewAll.js'

const UNTIL = '2099-01-01T00:00:00Z'
let user
beforeEach(async () => {
  user = uniqueUserId(); await openUserDb(user)
  for (const f of Object.values(api)) f.mockReset()
  api.on.mockResolvedValue(UNTIL)
  api.state.mockResolvedValue({ until: UNTIL, extra: ['st'] })
  await setMeta('member_st', { items: [1] })
  await setMeta('member_fr', { items: [2] })
  await setMeta(FEED_SIG, 'sig')
  await setMeta('goal_x', { keep: true })
})
afterEach(async () => { await closeUserDb() })

describe('adminViewAll (db)', () => {
  it('включить: снимок { until, extra } и синк', async () => {
    expect(await enableViewAll(user, 30)).toBe(UNTIL)
    expect(api.on).toHaveBeenCalledWith(user, 30)
    expect(await getViewAll()).toEqual({ until: UNTIL, extra: ['st'] })
    expect(api.sync).toHaveBeenCalledWith(user)
  })

  it('«чужие» не узнали — режим все равно включен, без пометок', async () => {
    api.state.mockRejectedValue(new Error('сеть'))
    await enableViewAll(user, 30)
    expect(await getViewAll()).toEqual({ until: UNTIL, extra: [] })
  })

  it('выключить: чистка member_* и метки Ленты, синк, снимок снят; прочий meta цел', async () => {
    await setMeta(VIEW_ALL_KEY, { until: UNTIL, extra: ['st'] })
    await disableViewAll(user)
    expect(api.off).toHaveBeenCalledWith(user)
    expect(await getMeta('member_st')).toBeUndefined()
    expect(await getMeta('member_fr')).toBeUndefined()
    expect(await getMeta(FEED_SIG)).toBeUndefined()
    expect(await getMeta('goal_x')).toEqual({ keep: true })
    expect(api.sync).toHaveBeenCalledWith(user)
    expect(await getViewAll()).toBeNull()
  })

  it('выключить не вышло — снимок и кэши как были', async () => {
    await setMeta(VIEW_ALL_KEY, { until: UNTIL, extra: ['st'] })
    api.off.mockRejectedValue(new Error('нет сети'))
    await expect(disableViewAll(user)).rejects.toThrow('нет сети')
    expect(await getViewAll()).not.toBeNull()
    expect(await getMeta('member_st')).toBeDefined()
  })

  it('сверка: режим идет — снимок обновляется; сервер сказал «нет» — чистка', async () => {
    expect(await refreshViewAll(user)).toEqual({ until: UNTIL, extra: ['st'] })
    expect(await getViewAll()).toEqual({ until: UNTIL, extra: ['st'] })
    api.state.mockResolvedValue({ until: null, extra: [] })
    expect(await refreshViewAll(user)).toBeNull()
    expect(await getViewAll()).toBeNull()
    expect(await getMeta('member_st')).toBeUndefined()
    expect(api.sync).toHaveBeenCalledTimes(1)
  })

  it('сверка: режима не было и нет — ни чистки, ни синка', async () => {
    api.state.mockResolvedValue({ until: null, extra: [] })
    expect(await refreshViewAll(user)).toBeNull()
    expect(await getMeta('member_st')).toBeDefined()
    expect(api.sync).not.toHaveBeenCalled()
  })

  it('сверка без сети — снимок не трогаем', async () => {
    await setMeta(VIEW_ALL_KEY, { until: UNTIL, extra: ['st'] })
    api.state.mockRejectedValue(new Error('offline'))
    expect(await refreshViewAll(user)).toEqual({ until: UNTIL, extra: ['st'] })
    expect(await getMeta('member_st')).toBeDefined()
  })

  it('без открытой базы — тихо', async () => {
    await closeUserDb()
    await expect(resetViewAllCaches(null)).resolves.toBeUndefined()
    expect(await refreshViewAll(user, null)).toBeNull()
    await openUserDb(user)
  })
})
