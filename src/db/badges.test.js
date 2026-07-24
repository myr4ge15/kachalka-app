// Интеграционные тесты db-обвязки достижений (db/badges.js) на реальном Dexie
// поверх fake-indexeddb. Чистый движок (lib/badges.js) покрыт отдельно — здесь
// проверяем ОРКЕСТРАЦИЮ: сбор данных экрана из истории, тихий бэкфилл вех задним
// числом и ключевое поведение детекта — ПЕРВЫЙ проход не спамит тостами (тихо
// размечает историю), последующее живое получение возвращает бейдж для тоста.
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { saveWorkout, getBadges } from './repo.js'
import { getBadgesView, backfillBadges, detectBadgesOnSave } from './badges.js'
import { BADGES } from '../lib/badges.js'

const bench = { id: 'ex_bench', name: 'Жим лёжа', muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' }
// Одинаковые тренировки: рекордов нет (minePrs требует prev>0), тоннаж мал —
// в игру входят только вехи регулярности (число тренировок), что и нужно.
const wk = (userId, at = '2026-02-01') =>
  saveWorkout({ user_id: userId, performed_at: at, entries: [{ exercise: bench, sets: [{ weight: 100, reps: 5 }] }] })

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
})
afterEach(async () => {
  await closeUserDb()
})

describe('getBadgesView', () => {
  it('пустая история → ничего не получено, структура валидна', async () => {
    const view = await getBadgesView(userId)
    expect(view.total).toBe(BADGES.length)
    expect(view.earnedCount).toBe(0)
    expect(view.cats).toHaveLength(4)
    expect(view.values.count).toBe(0)
    expect(view.next).toBeTruthy() // ближайшая незакрытая веха есть
  })

  it('первая тренировка закрывает веху reg_1', async () => {
    await wk(userId)
    const view = await getBadgesView(userId)
    expect(view.values.count).toBe(1)
    expect(view.earnedCount).toBeGreaterThanOrEqual(1)
    const reg = view.cats.find((c) => c.cat === 'regularity')
    const first = reg.badges.find((b) => b.def.id === 'reg_1')
    expect(first.done).toBe(true)
  })
})

describe('backfillBadges', () => {
  it('тихо штампует закрытые вехи как backfilled и идемпотентен', async () => {
    await wk(userId)
    await backfillBadges(userId)
    const map1 = await getBadges(userId)
    expect(map1.reg_1).toMatchObject({ backfilled: true })
    expect(map1.reg_1.at).toBeTruthy()
    // повторный вызов ничего не ломает и не переразмечает
    await backfillBadges(userId)
    const map2 = await getBadges(userId)
    expect(map2.reg_1.at).toBe(map1.reg_1.at)
  })
})

describe('detectBadgesOnSave', () => {
  it('первый проход (пустая meta) — бэкфилл без тоста: пусто, но дата проставлена', async () => {
    await wk(userId)
    const toasts = await detectBadgesOnSave(userId)
    expect(toasts).toEqual([]) // тостов на первом проходе нет
    const map = await getBadges(userId)
    expect(map.reg_1).toMatchObject({ backfilled: true })
  })

  it('живое получение после первого прохода возвращает бейдж для тоста', async () => {
    // 1) первый проход: одна тренировка → reg_1 размечен тихо
    await wk(userId)
    await detectBadgesOnSave(userId)
    // 2) добираем до 10 тренировок → reg_10 закрывается уже «вживую»
    for (let i = 0; i < 9; i++) await wk(userId)
    const toasts = await detectBadgesOnSave(userId)
    expect(toasts.map((d) => d.id)).toContain('reg_10')
    const map = await getBadges(userId)
    expect(map.reg_10.backfilled).toBe(false) // живое получение, не бэкфилл
  })
})
