import { describe, it, expect } from 'vitest'
import {
  normMetric,
  exerciseMetric,
  isCountMetric,
  leadingValue,
  fmtTime,
  parseTime,
  fmtMetricValue,
  fmtTemplateTarget,
  fmtSet,
} from './metric.js'

describe('normMetric', () => {
  it('пропускает допустимые метрики', () => {
    expect(normMetric('weight')).toBe('weight')
    expect(normMetric('reps')).toBe('reps')
    expect(normMetric('time')).toBe('time')
  })
  it('мусор/undefined/null → weight (обратная совместимость)', () => {
    expect(normMetric(undefined)).toBe('weight')
    expect(normMetric(null)).toBe('weight')
    expect(normMetric('')).toBe('weight')
    expect(normMetric('bogus')).toBe('weight')
    expect(normMetric(42)).toBe('weight')
  })
})

describe('exerciseMetric', () => {
  it('берёт metric из объекта упражнения, дефолт weight', () => {
    expect(exerciseMetric({ metric: 'time' })).toBe('time')
    expect(exerciseMetric({ metric: 'reps' })).toBe('reps')
    expect(exerciseMetric({})).toBe('weight')
    expect(exerciseMetric(null)).toBe('weight')
    expect(exerciseMetric(undefined)).toBe('weight')
  })
})

describe('isCountMetric', () => {
  it('weight — НЕ count, reps/time — count', () => {
    expect(isCountMetric('weight')).toBe(false)
    expect(isCountMetric('reps')).toBe(true)
    expect(isCountMetric('time')).toBe(true)
    expect(isCountMetric(undefined)).toBe(false) // → weight
  })
})

describe('leadingValue', () => {
  it('weight → макс. вес подхода', () => {
    const sets = [{ weight: 60, reps: 8 }, { weight: 80, reps: 3 }, { weight: 70, reps: 5 }]
    expect(leadingValue('weight', sets)).toBe(80)
  })
  it('reps → макс. повторов (вес игнорируется)', () => {
    const sets = [{ weight: 0, reps: 10 }, { weight: 0, reps: 15 }]
    expect(leadingValue('reps', sets)).toBe(15)
  })
  it('time → макс. секунд (хранятся в reps)', () => {
    const sets = [{ weight: 0, reps: 90 }, { weight: 0, reps: 120 }]
    expect(leadingValue('time', sets)).toBe(120)
  })
  it('краевые: пусто/undefined/нет подходов → 0', () => {
    expect(leadingValue('weight', [])).toBe(0)
    expect(leadingValue('weight', undefined)).toBe(0)
    expect(leadingValue('weight', null)).toBe(0)
    expect(leadingValue('reps', [{}])).toBe(0)
  })
})

describe('fmtTime', () => {
  it('секунды → м:сс', () => {
    expect(fmtTime(90)).toBe('1:30')
    expect(fmtTime(45)).toBe('0:45')
    expect(fmtTime(725)).toBe('12:05')
    expect(fmtTime(0)).toBe('0:00')
  })
  it('отрицательное/мусор → 0:00', () => {
    expect(fmtTime(-5)).toBe('0:00')
    expect(fmtTime('abc')).toBe('0:00')
    expect(fmtTime(undefined)).toBe('0:00')
  })
})

describe('parseTime', () => {
  it('м:сс → секунды', () => {
    expect(parseTime('1:30')).toBe(90)
    expect(parseTime('0:45')).toBe(45)
    expect(parseTime('12:05')).toBe(725)
  })
  it('голое число (строка/число) → секунды', () => {
    expect(parseTime('90')).toBe(90)
    expect(parseTime(90)).toBe(90)
    expect(parseTime(90.4)).toBe(90)
  })
  it('мусор/пусто → 0; отрицательное → 0', () => {
    expect(parseTime('')).toBe(0)
    expect(parseTime('abc')).toBe(0)
    expect(parseTime(null)).toBe(0)
    expect(parseTime(-5)).toBe(0)
  })
  it('round-trip parseTime(fmtTime(x)) === x', () => {
    for (const x of [0, 45, 90, 725]) expect(parseTime(fmtTime(x))).toBe(x)
  })
})

describe('fmtMetricValue', () => {
  it('форматирует по метрике', () => {
    expect(fmtMetricValue('weight', 80)).toBe('80 кг')
    expect(fmtMetricValue('reps', 12)).toBe('12')
    expect(fmtMetricValue('time', 90)).toBe('1:30')
  })
  it('мусорная метрика → weight; мусорное значение → 0', () => {
    expect(fmtMetricValue('bogus', 50)).toBe('50 кг')
    expect(fmtMetricValue('reps', undefined)).toBe('0')
    expect(fmtMetricValue('weight', null)).toBe('0 кг')
  })
})

describe('fmtTemplateTarget', () => {
  it('weight: подходы×повторы(×вес)', () => {
    expect(fmtTemplateTarget('weight', { sets: 3, reps: 10 })).toBe('3×10')
    expect(fmtTemplateTarget('weight', { sets: 3, reps: 10, weight: 60 })).toBe('3×10×60 кг')
  })
  it('reps без веса, time как секунды на подход', () => {
    expect(fmtTemplateTarget('reps', { sets: 3, reps: 10, weight: 60 })).toBe('3×10')
    expect(fmtTemplateTarget('time', { sets: 3, reps: 90 })).toBe('3×1:30')
  })
  it('нет подходов → пусто', () => {
    expect(fmtTemplateTarget('weight', { sets: 0, reps: 10 })).toBe('')
    expect(fmtTemplateTarget('weight', {})).toBe('')
  })
})

describe('fmtSet', () => {
  it('weight: вес×повторы, без веса — только повторы', () => {
    expect(fmtSet('weight', { weight: 80, reps: 8 })).toBe('80×8')
    expect(fmtSet('weight', { weight: 0, reps: 8 })).toBe('8')
  })
  it('reps → повторы, time → м:сс', () => {
    expect(fmtSet('reps', { weight: 0, reps: 12 })).toBe('12')
    expect(fmtSet('time', { weight: 0, reps: 90 })).toBe('1:30')
  })
})
