import { describe, it, expect } from 'vitest'
import { dotX, DOT_SIZE } from './tabDot.js'

describe('dotX', () => {
  it('ставит точку по центру вкладки относительно меню', () => {
    expect(DOT_SIZE).toBe(4)
    // меню с x=10, вкладка 80 px начиная с x=90 → центр 130 → от меню 120 → минус 2
    expect(dotX({ left: 10, width: 390 }, { left: 90, width: 80 })).toBe(118)
  })
  it('учитывает размер точки и округляет', () => {
    expect(dotX({ left: 0 }, { left: 0, width: 75 }, 6)).toBe(35)
  })
  it('без размеров — 0, а не NaN', () => {
    expect(dotX(null, { left: 1, width: 2 })).toBe(0)
    expect(dotX({ left: 0 }, { left: 'x', width: 10 })).toBe(0)
  })
})
