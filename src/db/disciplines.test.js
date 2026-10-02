import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
const server = vi.hoisted(() => ({ user: '', rpc: vi.fn() }))
vi.mock('./supabase.js', () => ({
  supabase: { rpc: (...args) => server.rpc(...args) }, isConfigured: true,
  hasSession: async id => server.user === id,
  serverIdentity: async () => ({ known: true, id: server.user }),
}))
import { openUserDb, closeUserDb, db, setMeta, getMeta } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { fetchRatingCatalog, fetchRatingBoard, getRatingCatalog, getRatingBoard, invalidateRatingCache } from './disciplines.js'
import { disciplineSignature } from '../lib/disciplines.js'

const d = { id: 'd1', exercise_id: 'e1', name: 'Жим', metric: 'weight', split_by_sex: true, updated_at: '2026-10-02' }
let user
beforeEach(async () => {
  user = uniqueUserId(); await openUserDb(user); server.user = user
  server.rpc.mockReset(); vi.stubGlobal('navigator', { onLine: true })
})
afterEach(async () => { await closeUserDb(); vi.unstubAllGlobals() })

describe('витрина дисциплин', () => {
  it('кэширует в персональной базе и соблюдает TTL', async () => {
    server.rpc.mockResolvedValue({ data: [d], error: null })
    await fetchRatingCatalog(user); await fetchRatingCatalog(user)
    expect(server.rpc).toHaveBeenCalledTimes(1)
    expect((await getRatingCatalog()).items).toEqual([d])
  })
  it('успешный пустой ответ удаляет старые результаты', async () => {
    await setMeta('rating_board_d1', { signature: disciplineSignature(d), rows: [{ user_id: 'old' }], fetchedAt: '2020-01-01' })
    server.rpc.mockResolvedValue({ data: { discipline: d, rows: [] }, error: null })
    await fetchRatingBoard(user,d)
    expect((await getRatingBoard(d)).rows).toEqual([])
  })
  it('ошибка не заменяет снимок и не продлевает TTL', async () => {
    const old = { items: [d], fetchedAt: '2020-01-01' }; await setMeta('rating_catalog',old)
    server.rpc.mockResolvedValue({ error: new Error('network') })
    await expect(fetchRatingCatalog(user)).rejects.toThrow('network')
    expect(await getRatingCatalog()).toEqual(old)
  })
  it('отозванная или чужая сессия не читает и не затирает кэш', async () => {
    server.user = null; await fetchRatingCatalog(user)
    expect(server.rpc).not.toHaveBeenCalled()
  })
  it('не переносит ответ в другую учетку при переключении во время запроса', async () => {
    let finish; let started
    const began = new Promise(r => { started = r })
    server.rpc.mockImplementation(() => { started(); return new Promise(r => { finish = r }) })
    const request = fetchRatingCatalog(user); await began
    await closeUserDb(); user=uniqueUserId(); await openUserDb(user); server.user=user
    finish({ data:[d],error:null }); await request
    expect(await getRatingCatalog()).toBeNull()
  })
  it('старый запрос не отменяет админскую инвалидацию', async () => {
    let finish; let started
    const began = new Promise(r => { started = r })
    server.rpc.mockImplementation(() => { started(); return new Promise(r => { finish = r }) })
    const request = fetchRatingCatalog(user); await began
    await invalidateRatingCache(); finish({ data:[d],error:null }); await request
    expect(await getRatingCatalog()).toBeNull()
  })
  it('смена метрики не показывает секунды как килограммы', async () => {
    await setMeta('rating_catalog',{ items:[d] })
    const changed = { ...d, metric:'time' }
    server.rpc.mockResolvedValue({ data:{ discipline:changed,rows:[{ user_id:'u',value:90,reps:90,weight:0 }] } })
    await fetchRatingBoard(user,d)
    expect(await getRatingBoard(d)).toBeNull()
    expect((await getRatingBoard(changed)).rows[0].value).toBe(90)
    expect((await getRatingCatalog()).items[0].metric).toBe('time')
  })
  it('инвалидация не удаляет пользовательские настройки', async () => {
    await setMeta('goal_u',{ target:100 }); await setMeta('rating_catalog',{ items:[d] })
    await invalidateRatingCache(db)
    expect(await getMeta('goal_u')).toEqual({ target:100 })
    expect(await getRatingCatalog()).toBeNull()
  })
})
