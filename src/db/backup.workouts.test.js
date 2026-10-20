// Бэкап тренировок и целей на настоящей Dexie (fake-indexeddb): выгрузка → восстановление
// на «чистом» устройстве уходит в очередь синка; повторный импорт не плодит копии; удаленное
// не воскресает; чужой файл не принимается (покрытие тестами 20.10.2026: db/backup.js 77 %).
import 'fake-indexeddb/auto' // ПЕРВЫМ: глобальный indexedDB до Dexie-модулей
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dl = vi.hoisted(() => ({ last: null }))
vi.mock('../lib/exportWorkout.js', async (orig) => ({ ...(await orig()), downloadJson: (obj) => { dl.last = obj } }))

import { openUserDb, closeUserDb, db } from './local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { saveWorkout, deleteWorkout, getWorkouts } from './repo.js'
import { readGoals, writeGoals } from './notifications.js'
import { exportAllMyData, importAllMyData } from './backup.js'

const BENCH = { id: 'ex_bench', name: 'Жим лежа', muscle_group: 'грудь', metric: 'weight', is_bench_lift: true, is_hidden: false }
const W1 = '11111111-1111-4111-8111-111111111111'
const W2 = '22222222-2222-4222-8222-222222222222'

let userId
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  await db.exercises.put(BENCH)
  dl.last = null
})
afterEach(async () => { await closeUserDb() })

async function seedAndExport() {
  await saveWorkout({ id: W1, user_id: userId, performed_at: '2026-10-01T10:00:00.000Z', entries: [{ exercise: BENCH, sets: [{ weight: 80, reps: 5 }] }] })
  await saveWorkout({ id: W2, user_id: userId, performed_at: '2026-10-05T10:00:00.000Z', entries: [{ exercise: BENCH, sets: [{ weight: 82.5, reps: 3 }] }] })
  await writeGoals(userId, [{ exerciseId: 'ex_bench', exerciseName: 'Жим лежа', metric: 'weight', targetWeight: 100, targetReps: null }])
  expect(await exportAllMyData(userId, '1.1.1')).toBe(2)
  return JSON.stringify(dl.last)
}

// «Новый телефон»: та же учетка, пустая персональная база.
async function freshDevice() {
  await closeUserDb()
  await indexedDB.deleteDatabase(`gym_app_${userId}`)
  await openUserDb(userId)
  await db.exercises.put(BENCH)
}

describe('бэкап тренировок', () => {
  it('восстановление на чистом устройстве: тренировки и цель на месте и ждут отправки', async () => {
    const text = await seedAndExport()
    await freshDevice()
    const counts = await importAllMyData(userId, text)
    expect(counts).toMatchObject({ workouts: 2, failed: 0 })
    const list = await getWorkouts(userId)
    expect(list.map((w) => w.id).sort()).toEqual([W1, W2])
    expect(list.find((w) => w.id === W2).entries[0].sets).toEqual([{ weight: 82.5, reps: 3 }])
    // Восстановленное уходит обычным синком: _dirty и операции в outbox.
    expect(list.every((w) => w._dirty)).toBe(true)
    expect((await db.outbox.toArray()).map((o) => o.workoutId).sort()).toEqual([W1, W2])
    expect((await readGoals(userId))[0]).toMatchObject({ exerciseId: 'ex_bench', targetWeight: 100, _dirty: 1 })
  })

  it('повторный импорт того же файла копий не плодит', async () => {
    const text = await seedAndExport()
    const counts = await importAllMyData(userId, text)
    expect(counts.workouts).toBe(0)
    expect(await getWorkouts(userId)).toHaveLength(2)
  })

  it('удаленная тренировка из старого бэкапа не воскресает', async () => {
    const text = await seedAndExport()
    await deleteWorkout(W1)
    await importAllMyData(userId, text)
    expect((await getWorkouts(userId)).map((w) => w.id)).toEqual([W2])
  })

  it('свою измененную тренировку файл не перетирает', async () => {
    const text = await seedAndExport()
    await saveWorkout({ id: W1, user_id: userId, performed_at: '2026-10-01T10:00:00.000Z', entries: [{ exercise: BENCH, sets: [{ weight: 90, reps: 1 }] }] })
    await importAllMyData(userId, text)
    expect((await db.workouts.get(W1)).entries[0].sets).toEqual([{ weight: 90, reps: 1 }])
  })

  it('чужой файл — отказ с именем владельца, ничего не записано', async () => {
    const text = await seedAndExport()
    const foreign = JSON.parse(text)
    foreign.user = { id: 'someone-else', name: 'Маша' }
    await freshDevice()
    await expect(importAllMyData(userId, JSON.stringify(foreign))).rejects.toThrow(/другому пользователю \(Маша\)/)
    expect(await getWorkouts(userId)).toEqual([])
  })

  it('тренировка, которую не записать (вес без повторов), считается в failed и не роняет импорт', async () => {
    const snap = JSON.parse(await seedAndExport())
    const bad = { ...snap.workouts[0], id: '33333333-3333-4333-8333-333333333333' }
    bad.entries = bad.entries.map((e) => ({ ...e, sets: [{ weight: 80, reps: 0 }] })) // вес без повторов: файл пропускает, запись — нет
    snap.workouts = [snap.workouts[1], bad]
    await freshDevice()
    const counts = await importAllMyData(userId, JSON.stringify(snap))
    expect(counts).toMatchObject({ workouts: 1, failed: 1 })
    expect((await getWorkouts(userId)).map((w) => w.id)).toEqual([snap.workouts[0].id])
  })

  it('битый файл — понятная ошибка', async () => {
    await expect(importAllMyData(userId, '{не json')).rejects.toThrow()
    expect(await getWorkouts(userId)).toEqual([])
  })
})
