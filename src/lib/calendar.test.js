import { describe, it, expect } from 'vitest'
import { localYmd, shiftMonth, monthOf, monthGrid, workoutsByDay, countInMonth, monthTitle } from './calendar.js'

describe('calendar', () => {
  it('сетка сентября 2026: с понедельника, 5 недель, соседние дни помечены', () => {
    const g = monthGrid({ year: 2026, month: 8 }, { today: new Date(2026, 8, 30, 10) })
    expect(g).toHaveLength(5)
    expect(g[0][0]).toMatchObject({ ymd: '2026-08-31', inMonth: false })
    expect(g[0][1]).toMatchObject({ ymd: '2026-09-01', day: 1, inMonth: true })
    const flat = g.flat()
    expect(flat.find((d) => d.today).ymd).toBe('2026-09-30')
    expect(flat.at(-1)).toMatchObject({ ymd: '2026-10-04', inMonth: false, future: true })
  })
  it('февраль 2027 начинается с понедельника — ровно 4 недели', () => {
    expect(monthGrid({ year: 2027, month: 1 })).toHaveLength(4)
  })
  it('сдвиг месяцев через год', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(monthOf(new Date(2026, 8, 5))).toEqual({ year: 2026, month: 8 })
    expect(monthOf('2026-09-01')).toEqual({ year: 2026, month: 8 })
    expect(localYmd('2026-09-01')).toBe('2026-09-01')
  })
  it('тренировки по локальным дням и счет за месяц', () => {
    const w = [
      { id: 'a', performed_at: new Date(2026, 8, 29, 23, 30).toISOString() },
      { id: 'b', performed_at: new Date(2026, 8, 29, 8).toISOString() },
      { id: 'c', performed_at: new Date(2026, 7, 31, 9).toISOString() },
      { id: 'x', performed_at: 'мусор' },
    ]
    const m = workoutsByDay(w)
    expect(m.get('2026-09-29').map((x) => x.id)).toEqual(['a', 'b'])
    expect(countInMonth(m, { year: 2026, month: 8 })).toBe(2)
    expect(localYmd('мусор')).toBe('')
    expect(monthTitle({ year: 2026, month: 8 })).toBe('Сентябрь 2026')
  })
})
