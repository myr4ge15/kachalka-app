import { describe, it, expect } from 'vitest'
import {
  clampWeight, clampReps, clampSet, repsMax,
  WEIGHT_MAX, REPS_MAX, TIME_MAX,
} from './setLimits.js'

describe('clampWeight', () => {
  it('обычный вес проходит как есть', () => {
    expect(clampWeight(80, 'weight')).toBe(80)
    expect(clampWeight(82.5, 'weight')).toBe(82.5)
  })
  it('отрицательный → 0', () => {
    expect(clampWeight(-5, 'weight')).toBe(0)
  })
  it('абсурдно большой → потолок WEIGHT_MAX', () => {
    expect(clampWeight(999999, 'weight')).toBe(WEIGHT_MAX)
  })
  it('NaN/мусор → null (подход отбрасывается)', () => {
    expect(clampWeight(NaN, 'weight')).toBe(null)
    expect(clampWeight('abc', 'weight')).toBe(null)
  })
  it('у не-весовых метрик вес всегда 0 (инвариант)', () => {
    expect(clampWeight(50, 'reps')).toBe(0)
    expect(clampWeight(50, 'time')).toBe(0)
  })
  it('округление до 2 знаков (лишние доли отбрасываются)', () => {
    expect(clampWeight(82.129, 'weight')).toBe(82.13)
    expect(clampWeight(20.1, 'weight')).toBe(20.1)
  })
})

describe('clampReps', () => {
  it('обычные повторы проходят', () => {
    expect(clampReps(10, 'weight')).toBe(10)
  })
  it('дробные округляются до целого', () => {
    expect(clampReps(10.4, 'weight')).toBe(10)
    expect(clampReps(10.6, 'weight')).toBe(11)
  })
  it('меньше 1 → null (пустой/нулевой подход)', () => {
    expect(clampReps(0, 'weight')).toBe(null)
    expect(clampReps(-3, 'weight')).toBe(null)
    expect(clampReps(0.4, 'weight')).toBe(null) // округлится в 0
  })
  it('NaN → null', () => {
    expect(clampReps(NaN, 'weight')).toBe(null)
    expect(clampReps('', 'weight')).toBe(null)
  })
  it('потолок для повторов — REPS_MAX', () => {
    expect(clampReps(999999, 'weight')).toBe(REPS_MAX)
    expect(clampReps(999999, 'reps')).toBe(REPS_MAX)
  })
  it('для time потолок — TIME_MAX (секунды)', () => {
    expect(clampReps(999999, 'time')).toBe(TIME_MAX)
    expect(clampReps(3600, 'time')).toBe(3600) // 1 ч проходит
  })
})

describe('repsMax', () => {
  it('time → TIME_MAX, остальное → REPS_MAX', () => {
    expect(repsMax('time')).toBe(TIME_MAX)
    expect(repsMax('reps')).toBe(REPS_MAX)
    expect(repsMax('weight')).toBe(REPS_MAX)
    expect(repsMax(undefined)).toBe(REPS_MAX) // легаси → weight
  })
})

describe('clampSet', () => {
  it('валидный весовой подход', () => {
    expect(clampSet(80, 10, 'weight')).toEqual({ weight: 80, reps: 10 })
  })
  it('отрицательный вес клампится, подход остаётся', () => {
    expect(clampSet(-100, 5, 'weight')).toEqual({ weight: 0, reps: 5 })
  })
  it('нулевые/отрицательные повторы → весь подход null', () => {
    expect(clampSet(80, 0, 'weight')).toBe(null)
    expect(clampSet(80, -1, 'weight')).toBe(null)
  })
  it('нечисловой вес → весь подход null', () => {
    expect(clampSet('xx', 10, 'weight')).toBe(null)
  })
  it('time-подход: вес обнуляется, секунды сохраняются', () => {
    expect(clampSet(0, 90, 'time')).toEqual({ weight: 0, reps: 90 })
  })
  it('reps-подход (свой вес): вес обнуляется', () => {
    expect(clampSet(0, 25, 'reps')).toEqual({ weight: 0, reps: 25 })
  })
  it('абсурдные вес и повторы клампятся к потолкам', () => {
    expect(clampSet(1e9, 1e9, 'weight')).toEqual({ weight: WEIGHT_MAX, reps: REPS_MAX })
  })
})
