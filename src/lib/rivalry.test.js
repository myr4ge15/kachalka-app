import { describe, expect, it } from 'vitest'
import { findNearestRival } from './rivalry.js'

const row = (id, weight, reps = 5, performed_at = '2026-07-01') => ({
  user_id: id,
  user_name: id.toUpperCase(),
  weight,
  reps,
  performed_at,
})

describe('findNearestRival', () => {
  it('находит участника прямо выше и разрыв по весу', () => {
    const result = findNearestRival([row('u1', 100), row('me', 95), row('u3', 80)], 'me')

    expect(result).toMatchObject({
      myPlace: 2,
      rivalPlace: 1,
      direction: 'above',
      gap: 5,
      gapMetric: 'weight',
      tied: false,
    })
    expect(result.rival.user_id).toBe('u1')
    expect(result.progress).toBe(95)
  })

  it('для первого места выбирает ближайшего ниже', () => {
    const result = findNearestRival([row('me', 110), row('u2', 100), row('u3', 90)], 'me')

    expect(result).toMatchObject({ direction: 'below', myPlace: 1, rivalPlace: 2, gap: 10 })
    expect(result.rival.user_id).toBe('u2')
    expect(result.progress).toBe(100)
  })

  it('при одинаковом весе показывает разрыв по повторам', () => {
    const result = findNearestRival([row('u1', 100, 8), row('me', 100, 6)], 'me')

    expect(result).toMatchObject({ gap: 2, gapMetric: 'reps', tied: false })
  })

  it('распознаёт полностью равный результат', () => {
    const result = findNearestRival([row('u1', 100, 6), row('me', 100, 6)], 'me')

    expect(result).toMatchObject({ gap: 0, tied: true })
  })

  it('устойчив к смене состава и не полагается на порядок кэша', () => {
    const result = findNearestRival([row('last', 70), row('me', 90), row('top', 100)], 'me')

    expect(result.rival.user_id).toBe('top')
    expect(result.myPlace).toBe(2)
  })

  it.each([
    [[], 'me'],
    [[row('me', 100)], 'me'],
    [[row('u1', 100), row('u2', 90)], 'me'],
    [[row('me', 100), row('u2', 90)], null],
  ])('возвращает null без пары для сравнения', (rows, userId) => {
    expect(findNearestRival(rows, userId)).toBeNull()
  })
})
