import { describe, it, expect } from 'vitest'
import { compareDisciplineRows, disciplineResult, disciplineGroup } from './disciplines.js'
import { findNearestRival } from './rivalry.js'

describe('результат дисциплины', () => {
  it('вес, повторы, секунды имеют разные единицы', () => {
    expect(disciplineResult('weight',80)).toBe('80 кг')
    expect(disciplineResult('reps',12)).toBe('12 повт.')
    expect(disciplineResult('time',90)).toBe('1:30')
    expect(disciplineGroup(null)).toBe('u')
  })
  it('при равном времени не учитывает сохраненный вес', () => {
    const a={ metric:'time',value:90,reps:90,weight:100,performed_at:'2026-02-01',user_id:'a' }
    const b={ metric:'time',value:90,reps:90,weight:0,performed_at:'2026-01-01',user_id:'b' }
    expect(compareDisciplineRows(a,b)).toBeGreaterThan(0)
  })
  it('ближайший ориентир по времени считает секунды и заполнение шкалы', () => {
    const rows=[{ user_id:'me',weight:100,reps:60 },{ user_id:'friend',weight:0,reps:90 }]
    expect(findNearestRival(rows,'me','time')).toMatchObject({ myPlace:2,gap:30,gapMetric:'time',progress:67 })
  })
})
