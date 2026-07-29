import { describe, expect, it } from 'vitest'
import { buildGoalGuide, selectProgressGoal } from './progressGoal.js'

describe('selectProgressGoal', () => {
  it('берёт только активную цель выбранного упражнения', () => {
    const goals = [
      { exerciseId: 'bench', targetWeight: 90, achievedAt: '2026-07-01' },
      { exerciseId: 'squat', targetWeight: 140 },
      { exerciseId: 'bench', targetWeight: 100 },
    ]
    expect(selectProgressGoal(goals, 'bench')?.targetWeight).toBe(100)
  })

  it('игнорирует tombstone и некорректную цель', () => {
    expect(selectProgressGoal([
      { exerciseId: 'bench', targetWeight: 100, _deleted: 1 },
      { exerciseId: 'bench', targetWeight: 0 },
    ], 'bench')).toBeNull()
  })
})

describe('buildGoalGuide', () => {
  it('считает разрыв до цели', () => {
    expect(buildGoalGuide({ metric: 'weight', targetWeight: 100 }, 92.5)).toEqual({
      metric: 'weight',
      target: 100,
      current: 92.5,
      left: 7.5,
      reps: 0,
      valueReached: false,
    })
  })

  it('сохраняет требование повторов, когда целевой вес уже поднимался', () => {
    const guide = buildGoalGuide({
      metric: 'weight',
      targetWeight: 100,
      targetReps: 5,
    }, 100)
    expect(guide.left).toBe(0)
    expect(guide.reps).toBe(5)
    expect(guide.valueReached).toBe(true)
  })
})

