import { describe, it, expect } from 'vitest'
import { byGender } from './gender.js'

describe('byGender', () => {
  it('женская форма только для f', () => {
    expect(byGender('f', 'тренировал', 'тренировала')).toBe('тренировала')
    expect(byGender('m', 'тренировал', 'тренировала')).toBe('тренировал')
    expect(byGender(null, 'тренировал', 'тренировала')).toBe('тренировал')
    expect(byGender(undefined, 'обошел', 'обошла')).toBe('обошел')
  })
})
