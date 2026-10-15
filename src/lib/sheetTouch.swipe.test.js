import { describe, expect, it } from 'vitest'
import { swipeDownAxis, swipeDownCommits } from './sheetTouch.js'

describe('свайп вниз по листу (v8.8.1)', () => {
  it('ось: вниз — только при явной вертикали', () => {
    expect(swipeDownAxis(2, 5)).toBeNull()
    expect(swipeDownAxis(3, 30)).toBe('down')
    expect(swipeDownAxis(30, 20)).toBe('other')
    expect(swipeDownAxis(0, -30)).toBe('other')
  })
  it('закрыть: на четверть высоты или быстрый бросок', () => {
    expect(swipeDownCommits(120, 0.1, 400)).toBe(true)
    expect(swipeDownCommits(60, 0.1, 400)).toBe(false)
    expect(swipeDownCommits(60, 0.8, 400)).toBe(true)
    expect(swipeDownCommits(30, 2, 400)).toBe(false)
    expect(swipeDownCommits(-10, 2, 400)).toBe(false)
  })
})
