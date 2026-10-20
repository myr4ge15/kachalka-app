// db/leaderboard.js — сетевая часть и ветка каталога дисциплин (покрытие тестами 20.10.2026:
// было 56 % строк). fetchLeaderboard: офлайн/без сессии не ходит, TTL не молотит RPC, пустой
// ответ не затирает снимок, старый сервер без board → мужской борд. getCachedLeaderboard с
// каталогом: жим из рейтинга дисциплин, убранный жим не воскресает из старого снимка.
import 'fake-indexeddb/auto' // ПЕРВЫМ: local.js создает Dexie на импорте
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: true, rpc: null, catalog: null, boards: {}, circleCatalogs: {} }))
vi.mock('./supabase.js', () => ({
  isConfigured: true,
  hasSession: async () => h.session,
  supabase: { rpc: (...a) => h.rpc(...a) },
}))
vi.mock('./disciplines.js', () => ({
  // каталог круга — h.circleCatalogs[id], общий — h.catalog
  getRatingCatalog: async (circle = null) => (circle ? h.circleCatalogs[circle] ?? null : h.catalog),
  getRatingBoard: async (d) => h.boards[d.id] ?? null,
}))

// db — живая привязка (null до входа): читаем через пространство имен модуля, не деструктуризацией.
const local = await import('./local.js')
const { openUserDb, closeUserDb, loginDb, getMeta, setMeta } = local
const { uniqueUserId } = await import('../test/idbHarness.js')
const { fetchLeaderboard, getCachedLeaderboard, getLeadExerciseNames } = await import('./leaderboard.js')

const ROWS = [
  { board: 'm', user_id: 'a', user_name: 'А', orm: '110.5', weight: '100', reps: '3', performed_at: '2026-10-01' },
  { user_id: 'b', user_name: null, orm: null, weight: 90, reps: 5 }, // старый сервер: без board, без имени и 1ПМ
  { board: 'f', user_id: 'c', user_name: 'В', orm: 80, weight: 70, reps: 8, performed_at: '2026-10-02' },
]

beforeEach(async () => {
  await openUserDb(uniqueUserId())
  Object.assign(h, { session: true, rpc: vi.fn(async () => ({ data: ROWS, error: null })), catalog: null, boards: {}, circleCatalogs: {} })
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(async () => { vi.unstubAllGlobals(); await closeUserDb() })

describe('fetchLeaderboard', () => {
  it('кладет снимок: числа из строк, без board → мужской, без имени → «Кто-то», 1ПМ null → 0', async () => {
    await fetchLeaderboard()
    expect(h.rpc).toHaveBeenCalledWith('leaderboard_bench')
    const rows = await local.db.leaderboard.toArray()
    const b = rows.find((r) => r.user_id === 'b')
    expect(b).toMatchObject({ board: 'm', user_name: 'Кто-то', orm: 0, weight: 90, reps: 5, performed_at: null })
    expect(rows.find((r) => r.user_id === 'a')).toMatchObject({ orm: 110.5, weight: 100, reps: 3 })
    expect(rows.find((r) => r.user_id === 'c').board).toBe('f')
    expect(await getMeta('leaderboardFetchedAt', local.db)).toBeTruthy()
  })

  it('офлайн и без сессии — к серверу не ходим', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await fetchLeaderboard()
    vi.stubGlobal('navigator', { onLine: true })
    h.session = false
    await fetchLeaderboard()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('TTL: второй вход через секунду не ходит, force — ходит', async () => {
    await fetchLeaderboard()
    await fetchLeaderboard()
    expect(h.rpc).toHaveBeenCalledTimes(1)
    await fetchLeaderboard({ force: true })
    expect(h.rpc).toHaveBeenCalledTimes(2)
  })

  it('пустой ответ не затирает снимок (временный сбой не «схлопывает» рейтинг)', async () => {
    await fetchLeaderboard()
    h.rpc.mockResolvedValue({ data: [], error: null })
    await fetchLeaderboard({ force: true })
    expect(await local.db.leaderboard.count()).toBe(3)
  })

  it('ошибка RPC — бросаем (экран покажет), снимок цел, метка TTL не сдвинута', async () => {
    await setMeta('leaderboardFetchedAt', '2026-01-01T00:00:00.000Z', local.db)
    h.rpc.mockResolvedValue({ data: null, error: new Error('permission denied') })
    await expect(fetchLeaderboard()).rejects.toThrow('permission denied')
    expect(await getMeta('leaderboardFetchedAt', local.db)).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('getCachedLeaderboard с каталогом дисциплин', () => {
  beforeEach(async () => {
    await local.db.exercises.bulkPut([
      { id: 'bench', name: 'Жим лежа', is_bench_lift: true },
      { id: 'glute', name: 'Ягодичный мостик', is_female_lift: true },
    ])
    await loginDb.users.bulkPut([{ id: 'm1', name: 'М', sex: 'm' }, { id: 'f1', name: 'Ж', sex: 'f' }])
    await local.db.leaderboard.put({ board: 'm', user_id: 'old', weight: 200, reps: 1 }) // старый снимок
  })

  it('жим из рейтинга дисциплин; без деления по полу — по полу зрителя из ростера', async () => {
    h.catalog = { items: [{ id: 'd1', exercise_id: 'bench', metric: 'weight', split_by_sex: false }] }
    h.boards.d1 = { rows: [
      { user_id: 'm1', weight: 90, reps: 1 }, { user_id: 'f1', weight: 50, reps: 5 }, { user_id: 'x', weight: 120, reps: 1 },
    ] }
    const { male, female } = await getCachedLeaderboard()
    expect(male.map((r) => r.user_id)).toEqual(['x', 'm1']) // неизвестный пол — мужской борд, сильнейший сверху
    expect(female).toEqual([]) // мостика в каталоге нет
  })

  it('с делением по полу — по полю board строки', async () => {
    h.catalog = { items: [{ id: 'd2', exercise_id: 'glute', metric: 'weight', split_by_sex: true }] }
    h.boards.d2 = { rows: [{ user_id: 'f1', board: 'f', weight: 80, reps: 5 }, { user_id: 'm1', board: 'm', weight: 100, reps: 5 }] }
    const { male, female } = await getCachedLeaderboard()
    expect(female.map((r) => r.user_id)).toEqual(['f1'])
    expect(male).toEqual([]) // жима в каталоге нет — старый снимок не воскресает
  })

  it('есть активный круг — место по доске первого круга, а не по старому общему (fb_2115b26b)', async () => {
    h.catalog = { items: [{ id: 'g', exercise_id: 'bench', metric: 'weight', split_by_sex: false }] }
    h.boards.g = { rows: [{ user_id: 'x', weight: 200, reps: 1 }, { user_id: 'm1', weight: 90, reps: 1 }] }
    h.circleCatalogs.c2 = { items: [{ id: 'cd', exercise_id: 'bench', metric: 'weight', split_by_sex: false }] }
    h.boards.cd = { rows: [{ user_id: 'm1', weight: 90, reps: 1 }] }
    await setMeta('fc_circles', { items: [
      { circle_id: 'c1', my_status: 'pending' }, { circle_id: 'c2', my_status: 'active' },
    ] }, local.db)
    expect((await getCachedLeaderboard()).male.map((r) => r.user_id)).toEqual(['m1'])
    delete h.circleCatalogs.c2 // доску круга еще не открывали — пусто, а не старое общее место
    expect(await getCachedLeaderboard()).toEqual({ male: [], female: [] })
  })

  it('имена ведущих упражнений — из справочника', async () => {
    expect(await getLeadExerciseNames()).toEqual({ male: 'Жим лежа', female: 'Ягодичный мостик' })
  })
})
