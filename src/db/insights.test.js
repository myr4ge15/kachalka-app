// Интеграционные тесты db-обвязки инсайтов/свежести (db/insights.js) на реальном
// Dexie поверх fake-indexeddb. Чистые движки (lib/insights, lib/homeSummary,
// lib/freshness) покрыты отдельно — здесь проверяем ПРОВОДКУ: что обвязка читает
// историю из базы и отдаёт корректно собранные структуры для Главной/экрана
// свежести/тоста после сохранения.
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { saveWorkout } from './repo.js'
import { getHomeData, detectInsightsOnSave, getFreshness } from './insights.js'

const bench = { id: 'ex_bench', name: 'Жим лёжа', muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' }
const entry = (ex, sets) => ({ exercise: ex, sets })
// Свежие даты относительно реального «сейчас» — detectInsightsOnSave/движки
// используют реальный Date, поэтому историю кладём недавней.
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}
const wk = (userId, at, sets) =>
  saveWorkout({ user_id: userId, performed_at: at, entries: [entry(bench, sets)] })

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
})
afterEach(async () => {
  await closeUserDb()
})

describe('getHomeData', () => {
  it('пустая история → валидная пустая структура', async () => {
    const data = await getHomeData(userId)
    expect(data.summary).toBeTruthy()
    expect(data.insights).toEqual([])
    expect(data.freshness.recovery).toEqual([])
    expect(data.freshness.imbalance).toBeInstanceOf(Array)
    expect(data.freshness.recoverySub).toBeInstanceOf(Array)
    expect(data.freshness.imbalanceSub).toBeInstanceOf(Array)
  })

  it('после тренировки — сводка и свежесть заполнены', async () => {
    await wk(userId, daysAgo(1), [{ weight: 100, reps: 5 }])
    const data = await getHomeData(userId)
    expect(data.summary).toBeTruthy()
    // тренированная группа попадает в recovery-список
    expect(data.freshness.recovery.length).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(data.insights)).toBe(true)
  })

  it('уважает max для числа инсайтов', async () => {
    for (let i = 0; i < 6; i++) await wk(userId, daysAgo(i * 4), [{ weight: 80 + i, reps: 5 }])
    const data = await getHomeData(userId, { max: 2 })
    expect(data.insights.length).toBeLessThanOrEqual(2)
  })
})

describe('detectInsightsOnSave', () => {
  it('рекордная тренировка даёт инсайт-рекорд (kind pr)', async () => {
    await wk(userId, daysAgo(7), [{ weight: 80, reps: 5 }])
    const wId = await wk(userId, daysAgo(0), [{ weight: 90, reps: 5 }])
    const insights = await detectInsightsOnSave(userId, wId)
    const pr = insights.find((i) => i.kind === 'pr')
    expect(pr).toBeTruthy()
    expect(pr.text).toContain('90')
  })

  it('первый замер по упражнению рекордом не считается', async () => {
    const wId = await wk(userId, daysAgo(0), [{ weight: 80, reps: 5 }])
    const insights = await detectInsightsOnSave(userId, wId)
    expect(insights.find((i) => i.kind === 'pr')).toBeFalsy()
  })
})

describe('getFreshness', () => {
  it('пустая история → пустые списки восстановления', async () => {
    const f = await getFreshness(userId)
    expect(f.recovery).toEqual([])
    expect(f.recoverySub).toEqual([])
    expect(f.imbalance).toBeInstanceOf(Array)
    expect(f.imbalanceSub).toBeInstanceOf(Array)
  })

  it('после тренировки груди — группа в recovery, а major/submuscle-уровни согласованы', async () => {
    await wk(userId, daysAgo(1), [{ weight: 100, reps: 5 }])
    const f = await getFreshness(userId)
    expect(f.recovery.length).toBeGreaterThanOrEqual(1)
    expect(f.recoverySub.length).toBeGreaterThanOrEqual(1)
  })
})
