import { describe, it, expect } from 'vitest'
import { groupVolumeTrend, trendLabel, WEEKS } from './groupVolume.js'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const daysAgo = (d) => new Date(NOW - d * 24 * 3600 * 1000).toISOString()
const ex = (group, sets) => ({ exercise: { muscle_group: group }, sets })
const wk = (d, ...entries) => ({ performed_at: daysAgo(d), entries })
const S = (n) => Array.from({ length: n }, () => ({ weight: 50, reps: 8 }))

describe('groupVolumeTrend', () => {
  it('раскладывает подходы по 7-дневным корзинам, текущая — последняя', () => {
    const [row] = groupVolumeTrend([wk(1, ex('грудь', S(3))), wk(8, ex('грудь', S(2))), wk(22, ex('грудь', S(4)))], NOW)
    expect(row.weeks).toHaveLength(WEEKS)
    expect(row.weeks).toEqual([4, 0, 2, 3])
  })

  it('дельта — последние две недели против двух предыдущих', () => {
    const rows = groupVolumeTrend([
      wk(2, ex('спина', S(6))), wk(9, ex('спина', S(6))),   // recent 12
      wk(16, ex('спина', S(5))), wk(23, ex('спина', S(5))), // prev 10
    ], NOW)
    expect(rows[0]).toMatchObject({ group: 'спина', recent: 12, prev: 10, pct: 20, trend: 'up', perWeek: 6 })
    expect(trendLabel(rows[0])).toBe('▲ +20%')
  })

  it('спад и «ровно» по порогу ±10%', () => {
    const down = groupVolumeTrend([wk(2, ex('ноги', S(4))), wk(20, ex('ноги', S(8)))], NOW)[0]
    expect(down).toMatchObject({ trend: 'down', pct: -50 })
    expect(trendLabel(down)).toBe('▼ −50%')
    const flat = groupVolumeTrend([wk(2, ex('ноги', S(10))), wk(20, ex('ноги', S(11)))], NOW)[0]
    expect(flat.trend).toBe('flat')
  })

  it('новая группа и пауза — без процентов', () => {
    const rows = groupVolumeTrend([wk(1, ex('пресс', S(3))), wk(20, ex('плечи', S(3)))], NOW)
    expect(rows.find((r) => r.group === 'пресс')).toMatchObject({ trend: 'new', pct: null })
    expect(rows.find((r) => r.group === 'плечи')).toMatchObject({ trend: 'gone', pct: null })
  })

  it('пустые строки, удаленные, будущие и старые тренировки не считаются', () => {
    const rows = groupVolumeTrend([
      wk(1, ex('грудь', [{ weight: 50, reps: 8 }, { weight: 0, reps: 0 }])),
      { ...wk(1, ex('грудь', S(5))), _deleted: true },
      wk(-1, ex('грудь', S(5))),
      wk(40, ex('грудь', S(5))),
    ], NOW)
    expect(rows[0].recent).toBe(1)
  })

  it('группа без muscle_group берется из подмышцы; сортировка по свежему объему', () => {
    const rows = groupVolumeTrend([
      wk(1, { exercise: { submuscle: 'lats' }, sets: S(2) }),
      wk(1, ex('грудь', S(5))),
    ], NOW)
    expect(rows.map((r) => r.group)).toEqual(['грудь', 'спина'])
  })
})
