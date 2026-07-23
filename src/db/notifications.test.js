// Интеграционные тесты db-обвязки уведомлений (db/notifications.js) на реальном
// Dexie поверх fake-indexeddb. Чистые алгоритмы (records.js/notifFilter.js) уже
// покрыты отдельно — здесь проверяем именно ОРКЕСТРАЦИЮ: чтение истории/целей из
// базы, детект рекордов/целей при сохранении (с записью achievedAt) и водяной
// знак «прочитано». Фокус — то, что пользователь видит на колокольчике и в тостах.
import 'fake-indexeddb/auto' // ПЕРВЫМ: ставит глобальный indexedDB до Dexie-модулей
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { saveWorkout } from './repo.js'
import {
  readGoals, writeGoals,
  getNotifications, getSeenAt, countUnread, markAllSeen,
  detectNewPrsOnSave, detectGoalReachedOnSave,
} from './notifications.js'

const bench = { id: 'ex_bench', name: 'Жим лёжа', muscle_group: 'грудь', is_bench_lift: true, metric: 'weight' }
const entry = (ex, sets) => ({ exercise: ex, sets })
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

describe('readGoals / writeGoals', () => {
  it('нет цели → пустой массив', async () => {
    expect(await readGoals(userId)).toEqual([])
  })

  it('легаси одиночный объект без metric → массив с metric="weight"', async () => {
    // Пишем «толстый» старый формат напрямую в meta через writeGoals-обход:
    // старое значение — одиночный объект цели (до мульти-целей).
    const { setMeta } = await import('./local.js')
    const { goalKey } = await import('./notifications.js')
    await setMeta(goalKey(userId), {
      exerciseId: 'ex_bench', exerciseName: 'Жим', targetWeight: 120, achievedAt: null,
    })
    const goals = await readGoals(userId)
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({ exerciseId: 'ex_bench', metric: 'weight', targetWeight: 120 })
  })

  it('массив сохраняется и читается без изменений', async () => {
    const g = [{ exerciseId: 'ex_bench', exerciseName: 'Жим', metric: 'weight', targetWeight: 100, achievedAt: null }]
    await writeGoals(userId, g)
    expect(await readGoals(userId)).toEqual(g)
  })
})

describe('detectNewPrsOnSave', () => {
  it('превышение прежнего максимума этой тренировкой → рекорд', async () => {
    await wk(userId, '2026-01-01', [{ weight: 80, reps: 5 }])
    const wId = await wk(userId, '2026-02-01', [{ weight: 90, reps: 5 }])
    const prs = await detectNewPrsOnSave(userId, wId)
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({ metric: 'weight', value: 90, prev: 80 })
  })

  it('первый замер по упражнению рекордом не считается (prev=0)', async () => {
    const wId = await wk(userId, '2026-01-01', [{ weight: 80, reps: 5 }])
    expect(await detectNewPrsOnSave(userId, wId)).toEqual([])
  })

  it('более слабая тренировка на фоне лучшей — не рекорд', async () => {
    const weak = await wk(userId, '2026-01-01', [{ weight: 80, reps: 5 }])
    await wk(userId, '2026-02-01', [{ weight: 90, reps: 5 }])
    expect(await detectNewPrsOnSave(userId, weak)).toEqual([])
  })

  it('несуществующий id тренировки → пусто', async () => {
    await wk(userId, '2026-01-01', [{ weight: 80, reps: 5 }])
    expect(await detectNewPrsOnSave(userId, 'no_such')).toEqual([])
  })
})

describe('detectGoalReachedOnSave', () => {
  const goal = (over = {}) => ([{
    exerciseId: 'ex_bench', exerciseName: 'Жим', metric: 'weight',
    targetWeight: 100, achievedAt: null, ...over,
  }])

  it('весовая цель достигнута этой тренировкой → возвращает и штампует achievedAt', async () => {
    await writeGoals(userId, goal())
    const wId = await wk(userId, '2026-02-01', [{ weight: 100, reps: 5 }])
    const reached = await detectGoalReachedOnSave(userId, wId)
    expect(reached).toHaveLength(1)
    expect(reached[0]).toMatchObject({ name: 'Жим', metric: 'weight', value: 100 })
    // achievedAt проставлен в самой цели (дедуп)
    const after = await readGoals(userId)
    expect(after[0].achievedAt).toBeTruthy()
  })

  it('уже достигнутая цель повторно не сообщается', async () => {
    await writeGoals(userId, goal({ achievedAt: '2026-01-01T00:00:00.000Z' }))
    const wId = await wk(userId, '2026-02-01', [{ weight: 105, reps: 5 }])
    expect(await detectGoalReachedOnSave(userId, wId)).toEqual([])
  })

  it('недобор веса → цель не достигнута', async () => {
    await writeGoals(userId, goal())
    const wId = await wk(userId, '2026-02-01', [{ weight: 95, reps: 5 }])
    expect(await detectGoalReachedOnSave(userId, wId)).toEqual([])
  })

  it('вес×повторы: нужный вес, но мало повторов — не достигнута', async () => {
    await writeGoals(userId, goal({ targetReps: 5 }))
    const wId = await wk(userId, '2026-02-01', [{ weight: 100, reps: 3 }])
    expect(await detectGoalReachedOnSave(userId, wId)).toEqual([])
  })

  it('вес×повторы: один подход с весом И повторами закрывает цель', async () => {
    await writeGoals(userId, goal({ targetReps: 5 }))
    await wk(userId, '2026-02-01', [{ weight: 100, reps: 3 }])
    const wId = await wk(userId, '2026-02-05', [{ weight: 100, reps: 5 }])
    const reached = await detectGoalReachedOnSave(userId, wId)
    expect(reached).toHaveLength(1)
    expect(reached[0]).toMatchObject({ metric: 'weight', value: 100, reps: 5 })
  })

  it('нет активных целей → ранний выход, пусто', async () => {
    const wId = await wk(userId, '2026-02-01', [{ weight: 100, reps: 5 }])
    expect(await detectGoalReachedOnSave(userId, wId)).toEqual([])
  })
})

describe('countUnread / markAllSeen / getSeenAt (водяной знак)', () => {
  it('достигнутая цель даёт непрочитанное, markAllSeen обнуляет', async () => {
    // Готовая достигнутая цель → уведомление типа goal в списке.
    await writeGoals(userId, [{
      exerciseId: 'ex_bench', exerciseName: 'Жим', metric: 'weight',
      targetWeight: 100, achievedAt: '2026-03-01T10:00:00.000Z',
    }])
    expect(await getSeenAt(userId)).toBe('') // ещё не открывали
    expect(await countUnread(userId)).toBeGreaterThanOrEqual(1)

    const list = await getNotifications(userId)
    expect(list.some((n) => n.type === 'goal')).toBe(true)
    await markAllSeen(userId, list)

    expect(await getSeenAt(userId)).toBeTruthy()
    expect(await countUnread(userId)).toBe(0)
  })

  it('getNotifications сортирует свежие сверху', async () => {
    await writeGoals(userId, [
      { exerciseId: 'ex_a', exerciseName: 'A', metric: 'weight', targetWeight: 50, achievedAt: '2026-01-01T00:00:00.000Z' },
      { exerciseId: 'ex_b', exerciseName: 'B', metric: 'weight', targetWeight: 60, achievedAt: '2026-05-01T00:00:00.000Z' },
    ])
    const list = await getNotifications(userId)
    const goals = list.filter((n) => n.type === 'goal')
    expect(goals).toHaveLength(2)
    // свежая (май) должна идти раньше старой (январь)
    expect(goals[0].at > goals[1].at).toBe(true)
  })
})
