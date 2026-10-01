import { describe, expect, it } from 'vitest'
import { buildMemberView, toWorkoutDoc } from './memberProfile.js'

const bench = (w, r) => ({
  exercise_id: 'bench', name: 'Жим лежа', metric: 'weight', is_bench_lift: true, sets: [{ weight: w, reps: r }],
})
const pull = (r) => ({ exercise_id: 'pull', name: 'Подтягивания', metric: 'reps', sets: [{ weight: 0, reps: r }, { weight: 0, reps: r - 2 }] })
const item = (id, iso, entries) => ({ id, user_id: 'dima', performed_at: iso, entries })

describe('toWorkoutDoc', () => {
  it('переносит поля упражнения во вложенный exercise', () => {
    const doc = toWorkoutDoc(item('w1', '2026-09-01T10:00:00Z', [bench(80, 5)]))
    expect(doc.entries[0].exercise).toEqual({
      id: 'bench', name: 'Жим лежа', muscle_group: null, metric: 'weight', is_bench_lift: true,
    })
    expect(doc.entries[0].sets).toEqual([{ weight: 80, reps: 5 }])
  })
})

describe('buildMemberView', () => {
  const now = new Date('2026-10-01T12:00:00')

  it('пустой участник — нули без падений', () => {
    const v = buildMemberView([], { total: 0, now })
    expect(v).toMatchObject({ total: 0, thisMonth: 0, streak: 0, streakFloor: false, records: [], fav: null, lastAt: null })
  })

  it('рекорды, любимое и свежее сверху', () => {
    const v = buildMemberView([
      item('a', '2026-09-20T10:00:00', [bench(80, 5), pull(10)]),
      item('b', '2026-09-30T10:00:00', [bench(85, 3), pull(12)]),
      item('c', '2026-10-01T09:00:00', [pull(8)]),
    ], { total: 3, now })
    expect(v.recent.map((w) => w.id)).toEqual(['c', 'b', 'a'])
    expect(v.records[0]).toMatchObject({ exId: 'bench', value: 85, isBench: true })
    expect(v.records.find((r) => r.exId === 'pull').value).toBe(12)
    expect(v.fav).toMatchObject({ exId: 'pull', name: 'Подтягивания', sets: 6 })
    expect(v.thisMonth).toBe(1)
    expect(v.lastAt).toBe('2026-10-01T09:00:00')
    expect(v.windowFull).toBe(false)
  })

  it('total с сервера берется, если он не меньше окна', () => {
    const list = [item('a', '2026-09-30T10:00:00', [bench(80, 5)])]
    expect(buildMemberView(list, { total: 120, now }).total).toBe(120)
    expect(buildMemberView(list, { total: null, now }).total).toBe(1)
    expect(buildMemberView(list, { total: 0, now }).total).toBe(1)
  })

  it('серия, упершаяся в начало полного окна, — нижняя граница', () => {
    // 3 тренировки в 3 последние недели, окно = 3 → дальше не видно
    const list = [
      item('a', '2026-09-30T10:00:00', [bench(80, 5)]),
      item('b', '2026-09-23T10:00:00', [bench(80, 5)]),
      item('c', '2026-09-16T10:00:00', [bench(80, 5)]),
    ]
    const full = buildMemberView(list, { total: 40, limit: 3, now })
    expect(full.streak).toBe(3)
    expect(full.streakFloor).toBe(true)
    const notFull = buildMemberView(list, { total: 3, limit: 60, now })
    expect(notFull.streakFloor).toBe(false)
  })

  it('серия с разрывом внутри окна — честное число', () => {
    const list = [
      item('a', '2026-09-30T10:00:00', [bench(80, 5)]),
      item('b', '2026-09-23T10:00:00', [bench(80, 5)]),
      item('c', '2026-09-02T10:00:00', [bench(80, 5)]),
    ]
    const v = buildMemberView(list, { total: 40, limit: 3, now })
    expect(v.streak).toBe(2)
    expect(v.streakFloor).toBe(false)
  })
})
