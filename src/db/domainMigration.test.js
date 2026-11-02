// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { openUserDb, closeUserDb, db, setMeta } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { writeDraft, resetDraftMemory } from '../lib/draftStore.js'
import { syncNow } from './sync.js'
import { checkDomainMigration } from './domainMigration.js'

vi.mock('./sync.js', () => ({ syncNow: vi.fn() }))
let uid
beforeEach(async () => {
  uid = uniqueUserId()
  await openUserDb(uid)
  localStorage.clear()
  resetDraftMemory()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.mocked(syncNow).mockReset().mockResolvedValue(true)
})
afterEach(async () => { await closeUserDb(); vi.restoreAllMocks() })

it('разрешает переход только после успешного синка и проверки базы', async () => {
  expect(await checkDomainMigration(uid)).toBe('ready')
  expect(syncNow).toHaveBeenCalledWith(uid)
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
it.each([false, undefined])('сбой или уже идущий синк (%s) не дают разрешения', async (result) => {
  vi.mocked(syncNow).mockResolvedValue(result)
  expect(await checkDomainMigration(uid)).toBe('sync')
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
