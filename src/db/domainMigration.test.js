// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { openUserDb, closeUserDb, db, setMeta } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { writeDraft, resetDraftMemory } from '../lib/draftStore.js'
import { syncNow, getSyncState } from './sync.js'
import { checkDomainMigration, inspectDomainMigration } from './domainMigration.js'

vi.mock('./sync.js', () => ({ syncNow: vi.fn(), getSyncState: vi.fn() }))
let uid
beforeEach(async () => {
  uid = uniqueUserId()
  await openUserDb(uid)
  localStorage.clear()
  resetDraftMemory()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.mocked(syncNow).mockReset().mockResolvedValue(true)
  vi.mocked(getSyncState).mockReset().mockReturnValue({ lastSyncAt: null, syncing: false, netError: true })
})
afterEach(async () => { vi.useRealTimers(); await closeUserDb(); vi.restoreAllMocks() })

it('разрешает переход только после успешного синка и проверки базы', async () => {
  expect(await checkDomainMigration(uid)).toBe('ready')
  expect(syncNow).toHaveBeenCalledWith(uid)
})
it('после отправки отметки замечает новые правки и черновик без повторного сетевого синка', async () => {
  expect(await checkDomainMigration(uid)).toBe('ready')
  await db.outbox.add({ workoutId: 'changed-while-reporting' })
  expect(await inspectDomainMigration(uid)).toBe('pending')
  await db.outbox.clear()
  writeDraft(`workout_draft_new_${uid}`, [{ exercise: { id: 'x' } }])
  expect(await inspectDomainMigration(uid)).toBe('draft')
  expect(syncNow).toHaveBeenCalledTimes(1)
})
it('не проверяет чужую учетку или закрытую базу', async () => {
  expect(await checkDomainMigration('other')).toBe('account')
  await closeUserDb()
  expect(await checkDomainMigration(uid)).toBe('account')
  expect(await checkDomainMigration(null)).toBe('account')
  expect(syncNow).not.toHaveBeenCalled()
})
it('офлайн и черновик блокируют переход до сетевых вызовов', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  expect(await checkDomainMigration(uid)).toBe('offline')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  writeDraft(`workout_draft_new_${uid}`, [{ exercise: { id: 'x' } }])
  expect(await checkDomainMigration(uid)).toBe('draft')
  expect(syncNow).not.toHaveBeenCalled()
})
it.each([false, undefined])('сбой или отсутствие свежего успешного синка (%s) не дают разрешения', async (result) => {
  vi.mocked(syncNow).mockResolvedValue(result)
  expect(await checkDomainMigration(uid)).toBe('sync')
})

it('ждет уже идущий синк, затем проверяет локальную базу без нового прогона', async () => {
  const state = { lastSyncAt: 'before', syncing: true, netError: false }
  getSyncState.mockImplementation(() => state)
  syncNow.mockResolvedValue(undefined)
  const checking = checkDomainMigration(uid)
  await vi.waitFor(() => expect(getSyncState.mock.calls.length).toBeGreaterThan(1))
  state.lastSyncAt = 'after'
  state.syncing = false
  expect(await checking).toBe('ready')
  expect(syncNow).toHaveBeenCalledTimes(1)
})
it('старый успешный lastSyncAt не разрешает переход после пропущенного прогона', async () => {
  vi.useFakeTimers()
  getSyncState.mockReturnValue({ lastSyncAt: 'old', syncing: false, netError: false })
  syncNow.mockResolvedValue(undefined)
  const checking = checkDomainMigration(uid)
  await vi.advanceTimersByTimeAsync(30000)
  expect(await checking).toBe('sync')
})
it('смена учетки и потеря сети во время ожидания не дают подтверждения', async () => {
  vi.useFakeTimers()
  getSyncState.mockReturnValue({ lastSyncAt: null, syncing: true, netError: false })
  syncNow.mockResolvedValue(undefined)
  const checking = checkDomainMigration(uid)
  await vi.advanceTimersByTimeAsync(100)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await vi.advanceTimersByTimeAsync(100)
  expect(await checking).toBe('offline')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  const another = checkDomainMigration(uid)
  await vi.advanceTimersByTimeAsync(100)
  await closeUserDb()
  await vi.advanceTimersByTimeAsync(100)
  expect(await another).toBe('account')
})
it.each(['outbox', 'ex_outbox', 'tpl_outbox', 'reaction_outbox'])('учитывает очередь %s, включая dead-letter', async (table) => {
  await db.table(table).add({ _dead: 1 })
  expect(await checkDomainMigration(uid)).toBe('pending')
})
it.each(['workouts', 'exercises', 'templates'])('учитывает dirty в %s без операции в очереди', async (table) => {
  await db.table(table).put({ id: 'x', _dirty: 1 })
  expect(await checkDomainMigration(uid)).toBe('pending')
})
it.each([[{ _dirty: 1 }], { _dirty: 1 }])('учитывает несинхронизированные цели %j', async (goals) => {
  await setMeta(`goal_${uid}`, goals)
  expect(await checkDomainMigration(uid)).toBe('pending')
})
it('учитывает настройки; чистые цели и настройки не мешают', async () => {
  await setMeta('user_meta_state', { body: { dirty: 1 } })
  expect(await checkDomainMigration(uid)).toBe('pending')
  await setMeta('user_meta_state', { body: { dirty: 0 }, accent: null })
  await setMeta(`goal_${uid}`, [{ _dirty: 0 }])
  expect(await checkDomainMigration(uid)).toBe('ready')
})
it('смена учетки во время синка блокирует переход', async () => {
  vi.mocked(syncNow).mockImplementation(async () => { await closeUserDb(); return true })
  expect(await checkDomainMigration(uid)).toBe('account')
})
it('черновик, появившийся во время синка, тоже блокирует переход', async () => {
  vi.mocked(syncNow).mockImplementation(async () => {
    writeDraft(`workout_edit_${uid}_x`, { entries: [] })
    return true
  })
  expect(await checkDomainMigration(uid)).toBe('draft')
})
it('смена учетки во время чтения базы блокирует переход', async () => {
  const original = db.transaction.bind(db)
  vi.spyOn(db, 'transaction').mockImplementation(async (...args) => {
    const result = await original(...args)
    await closeUserDb()
    return result
  })
  expect(await checkDomainMigration(uid)).toBe('account')
})
