import { describe, it, expect } from 'vitest'
import {
  BADGES,
  maxStreakWeeks,
  currentValues,
  badgeProgress,
  evaluateBadges,
  nextBadge,
  fmtBadgeValue,
  badgeEarnedDates,
} from './badges.js'

const wk = (id, performed_at, entries = []) => ({ id, performed_at, entries })
const setW = (weight, reps) => ({ weight, reps })
// упражнение с весом
const exW = (exId, sets) => ({ exercise_id: exId, exercise: { id: exId, name: exId }, sets })

const byId = Object.fromEntries(BADGES.map((b) => [b.id, b]))

describe('maxStreakWeeks', () => {
  it('пусто / без даты → 0', () => {
    expect(maxStreakWeeks([])).toBe(0)
    expect(maxStreakWeeks(undefined)).toBe(0)
    expect(maxStreakWeeks([{ id: 'x' }])).toBe(0)
  })
  it('максимальная непрерывная серия недель за историю (не текущая)', () => {
    // 3 недели подряд, пропуск, затем 2 недели подряд → max = 3
    const workouts = [
      wk('a', '2026-01-05'), // неделя N
      wk('b', '2026-01-12'), // N+1
      wk('c', '2026-01-19'), // N+2
      wk('d', '2026-02-02'), // N+4 (пропуск N+3)
      wk('e', '2026-02-09'), // N+5
    ]
    expect(maxStreakWeeks(workouts)).toBe(3)
  })
  it('несколько тренировок в одной неделе не раздувают серию', () => {
    const workouts = [wk('a', '2026-01-05'), wk('b', '2026-01-07'), wk('c', '2026-01-08')]
    expect(maxStreakWeeks(workouts)).toBe(1)
  })
})

describe('currentValues', () => {
  it('считает count/tonnage/prCount и обе серии', () => {
    const workouts = [
      wk('w1', '2026-01-05', [exW('bench', [setW(50, 5)])]), // tonnage 250
      wk('w2', '2026-01-12', [exW('bench', [setW(60, 5)])]), // +300, PR (60>50)
      wk('w3', '2026-01-19', [exW('bench', [setW(70, 5)])]), // +350, PR (70>60)
    ]
    const v = currentValues(workouts, new Date('2026-01-20'))
    expect(v.count).toBe(3)
    expect(v.tonnage).toBe(250 + 300 + 350)
    expect(v.prCount).toBe(2) // первый бенч рекордом не считается (prev=0)
    expect(v.maxStreakWeeks).toBe(3)
  })
  it('пустая история → нули', () => {
    const v = currentValues([], new Date('2026-01-20'))
    expect(v).toMatchObject({ count: 0, tonnage: 0, prCount: 0, maxStreakWeeks: 0 })
  })
})

describe('badgeProgress', () => {
  it('ровно на пороге засчитывается (>=)', () => {
    expect(badgeProgress(byId.reg_10, { count: 10 })).toMatchObject({ done: true, pct: 100 })
  })
  it('ниже порога — прогресс в процентах', () => {
    expect(badgeProgress(byId.reg_10, { count: 6 })).toMatchObject({ done: false, value: 6, target: 10, pct: 60 })
  })
  it('pct ограничен сотней', () => {
    expect(badgeProgress(byId.reg_1, { count: 42 }).pct).toBe(100)
  })
})

describe('evaluateBadges', () => {
  it('несколько вех одной категории закрываются разом', () => {
    const { earned, newlyEarned } = evaluateBadges({ count: 10 }, {})
    expect(newlyEarned).toEqual(expect.arrayContaining(['reg_1', 'reg_10']))
    expect(newlyEarned).not.toContain('reg_50')
    expect(earned).toEqual(expect.arrayContaining(['reg_1', 'reg_10']))
  })
  it('необратимость: показатель упал, но бейдж уже выдан — остаётся получен, без повторного тоста', () => {
    const earnedMap = { streak_3: { at: '2026-01-01T00:00:00Z' } }
    const { earned, newlyEarned } = evaluateBadges({ maxStreakWeeks: 1 }, earnedMap)
    expect(earned).toContain('streak_3') // не снят, хотя серия=1
    expect(newlyEarned).not.toContain('streak_3') // уже был — тоста нет
  })
  it('уже выданное не попадает в newlyEarned повторно', () => {
    const { newlyEarned } = evaluateBadges({ count: 1 }, { reg_1: { at: 'x' } })
    expect(newlyEarned).not.toContain('reg_1')
  })
  it('пустые значения → ничего не получено', () => {
    const { earned, newlyEarned } = evaluateBadges({}, {})
    expect(earned).toEqual([])
    expect(newlyEarned).toEqual([])
  })
})

describe('nextBadge', () => {
  it('объём между порогами → ближайшая незакрытая веха (vol_100 на 50%)', () => {
    const nb = nextBadge({ count: 0, maxStreakWeeks: 0, tonnage: 50_000, prCount: 0 })
    expect(nb.def.id).toBe('vol_100')
    expect(nb.pct).toBe(50)
    expect(nb.remaining).toBe(50_000)
  })
  it('всё получено → null', () => {
    const nb = nextBadge({ count: 999, maxStreakWeeks: 999, tonnage: 9_000_000, prCount: 999 })
    expect(nb).toBeNull()
  })
})

describe('badgeEarnedDates', () => {
  it('регулярность — дата N-й тренировки (в хронологии, не по порядку массива)', () => {
    const workouts = [
      wk('c', '2026-01-19'),
      wk('a', '2026-01-05'),
      wk('b', '2026-01-12'),
    ]
    const d = badgeEarnedDates(workouts)
    expect(d.reg_1).toBe('2026-01-05') // 1-я по хронологии
    expect(d.reg_10).toBeUndefined() // порог не достигнут
  })
  it('объём — момент пересечения порога накопленным тоннажем', () => {
    // vol_10 = 10 000 кг. 100×50=5000, +100×60=11000 (пересекли на 2-й)
    const workouts = [
      wk('a', '2026-01-01', [exW('sq', [setW(100, 50)])]), // 5000
      wk('b', '2026-01-08', [exW('sq', [setW(100, 60)])]), // +6000 = 11000 ≥ 10000
    ]
    const d = badgeEarnedDates(workouts)
    expect(d.vol_10).toBe('2026-01-08')
  })
  it('рекорды — дата N-го личного рекорда', () => {
    const workouts = [
      wk('w1', '2026-01-01', [exW('b', [setW(50, 5)])]),
      wk('w2', '2026-01-08', [exW('b', [setW(60, 5)])]), // 1-й PR
      wk('w3', '2026-01-15', [exW('b', [setW(70, 5)])]), // 2-й PR
    ]
    const d = badgeEarnedDates(workouts)
    expect(d.pr_1).toBe('2026-01-08')
  })
  it('серии — дата тренировки, завершившей серию нужной длины', () => {
    const workouts = [
      wk('a', '2026-01-05'), // неделя N
      wk('b', '2026-01-12'), // N+1
      wk('c', '2026-01-19'), // N+2 → серия достигла 3
    ]
    const d = badgeEarnedDates(workouts)
    expect(d.streak_3).toBe('2026-01-19')
    expect(d.streak_7).toBeUndefined()
  })
  it('пустая история → пусто', () => {
    expect(badgeEarnedDates([])).toEqual({})
  })
})

describe('fmtBadgeValue', () => {
  it('объём форматируется тоннами', () => {
    expect(fmtBadgeValue(byId.vol_1000, byId.vol_1000.threshold)).toBe('1000 т')
    expect(fmtBadgeValue(byId.vol_10, byId.vol_10.threshold)).toBe('10 т')
  })
  it('остальные категории — целое число', () => {
    expect(fmtBadgeValue(byId.reg_10, 10)).toBe('10')
    expect(fmtBadgeValue(byId.streak_3, 3)).toBe('3')
  })
})
