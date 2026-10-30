import { describe, it, expect } from 'vitest'
import { ratingRailEmpty, compareDisciplineRows, disciplineResult, disciplineGroup } from './disciplines.js'
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

describe('ratingRailEmpty: когда прятать строку «Рейтинг»', () => {
  const member = (id = 'c1') => ({ circle_id: id, my_status: 'active', is_owner: false })
  const empty = { fetchedAt: 't', items: [] }

  it('без круга и до загрузки кругов строка на месте: она зовет создать круг', () => {
    expect(ratingRailEmpty(null, {})).toBe(false)
    expect(ratingRailEmpty([], {})).toBe(false)
    expect(ratingRailEmpty([{ ...member(), my_status: 'pending' }], { c1: empty })).toBe(false)
  })

  it('участник круга без дисциплин: тупик, прячем', () => {
    expect(ratingRailEmpty([member()], { c1: empty })).toBe(true)
  })

  it('владелец может добавить дисциплины: строка на месте', () => {
    expect(ratingRailEmpty([{ ...member(), is_owner: true }], { c1: empty })).toBe(false)
  })

  it('каталог неизвестен (офлайн, первая загрузка): не прячем', () => {
    expect(ratingRailEmpty([member()], { c1: null })).toBe(false)
    expect(ratingRailEmpty([member()], {})).toBe(false)
  })

  it('есть дисциплины хотя бы в одном круге: строка на месте', () => {
    expect(ratingRailEmpty([member('a'), member('b')], { a: empty, b: { items: [{ id: 'd' }] } })).toBe(false)
  })
})

