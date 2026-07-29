import { describe, expect, it } from 'vitest'
import { exerciseUsageSections } from './exerciseUsage.js'

const entry = (id) => ({ exercise: { id } })
const workout = (id, day, ids, extra = {}) => ({
  id,
  performed_at: `2026-07-${String(day).padStart(2, '0')}T10:00:00Z`,
  entries: ids.map(entry),
  ...extra,
})

describe('exerciseUsageSections', () => {
  it('собирает недавние по хронологии и не считает дубли упражнения внутри тренировки', () => {
    const result = exerciseUsageSections([
      workout('old', 1, ['a', 'c']),
      workout('new', 20, ['b', 'b', 'a']),
    ], { recentLimit: 3 })

    expect(result.recent).toEqual(['b', 'a', 'c'])
  })

  it('частые сортирует по числу сессий и исключает уже показанные недавние', () => {
    const result = exerciseUsageSections([
      workout('w1', 1, ['a', 'c', 'd']),
      workout('w2', 2, ['a', 'c', 'd']),
      workout('w3', 3, ['a', 'c']),
      workout('w4', 4, ['b']),
    ], { recentLimit: 1, frequentLimit: 3 })

    expect(result.recent).toEqual(['b'])
    expect(result.frequent).toEqual(['a', 'c', 'd'])
  })

  it('не показывает одноразовые упражнения как частые и пропускает удалённые записи', () => {
    const result = exerciseUsageSections([
      workout('gone', 30, ['x'], { _deleted: 1 }),
      workout('one', 10, ['y']),
    ])

    expect(result).toEqual({ recent: ['y'], frequent: [] })
  })
})
