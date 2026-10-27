// «Видеть всех» (27.10.2026): срок, остаток, «чужие» и фильтр окна Ленты.
import { describe, expect, it } from 'vitest'
import { VIEW_ALL_CHOICES, leftLabel, minutesLeft, viewAllActive, viewAllExtra, withoutExtra } from './viewAll.js'

const NOW = Date.parse('2026-10-27T12:00:00Z')

describe('viewAll', () => {
  it('режим идет только до срока', () => {
    expect(viewAllActive({ until: '2026-10-27T12:30:00Z' }, NOW)).toBe(true)
    expect(viewAllActive({ until: '2026-10-27T12:00:00Z' }, NOW)).toBe(false)
    expect(viewAllActive({ until: 'мусор' }, NOW)).toBe(false)
    expect(viewAllActive(null, NOW)).toBe(false)
  })

  it('«чужие» — из снимка, и после срока (до чистки)', () => {
    expect([...viewAllExtra({ until: '2026-10-27T11:00:00Z', extra: ['a', 'b'] })]).toEqual(['a', 'b'])
    expect(viewAllExtra(null).size).toBe(0)
    expect(viewAllExtra({ extra: 'не массив' }).size).toBe(0)
  })

  it('withoutExtra выкидывает «чужих», без них — тот же список', () => {
    const items = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }]
    expect(withoutExtra(items, new Set(['b']))).toEqual([{ user_id: 'a' }, { user_id: 'c' }])
    expect(withoutExtra(items, new Set())).toBe(items)
    expect(withoutExtra(null, new Set(['b']))).toEqual([])
  })

  it('остаток — вверх до минуты, часы — с минутами', () => {
    expect(minutesLeft('2026-10-27T12:00:01Z', NOW)).toBe(1)
    expect(minutesLeft('2026-10-27T11:00:00Z', NOW)).toBe(0)
    expect(minutesLeft(null, NOW)).toBe(0)
    expect(leftLabel('2026-10-27T12:23:00Z', NOW)).toBe('23 мин')
    expect(leftLabel('2026-10-27T14:00:00Z', NOW)).toBe('2 ч')
    expect(leftLabel('2026-10-27T13:05:00Z', NOW)).toBe('1 ч 5 мин')
  })

  it('кнопки — в пределах сервера (5..240 мин)', () => {
    for (const c of VIEW_ALL_CHOICES) expect(c.minutes >= 5 && c.minutes <= 240).toBe(true)
  })
})
