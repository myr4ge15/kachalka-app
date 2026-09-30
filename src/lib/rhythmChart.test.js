import { describe, it, expect } from 'vitest'
import { rhythmChart, fmtAvg, avgWord, mondayLabel } from './rhythmChart.js'

const wk = (count, { current = false, beforeFirst = false, start = '2026-09-07' } = {}) => ({ count, current, beforeFirst, start })

describe('rhythmChart', () => {
  it('среднее — по завершённым неделям, текущая не занижает', () => {
    const r = rhythmChart([wk(2), wk(3), wk(2), wk(0, { current: true })])
    expect(r).toMatchObject({ mode: 'avg', avg: 2.3, weeks: 3, max: 3, total: 7 })
  })
  it('недели до первой тренировки в среднее не идут', () => {
    const r = rhythmChart([wk(0, { beforeFirst: true }), wk(0, { beforeFirst: true }), wk(2), wk(3), wk(1, { current: true })])
    expect(r).toMatchObject({ mode: 'avg', avg: 2.5, weeks: 2 })
  })
  it('меньше одной в неделю — не дробь, а итог за период', () => {
    const r = rhythmChart([wk(1), wk(0), wk(0), wk(0), wk(0), wk(0), wk(0), wk(0, { current: true })])
    expect(r).toMatchObject({ mode: 'total', total: 1, weeks: 7, onlyCurrent: false })
  })
  it('первая тренировка на этой неделе — итог «на этой неделе»', () => {
    const r = rhythmChart([wk(0, { beforeFirst: true }), wk(2, { current: true })])
    expect(r).toMatchObject({ mode: 'total', total: 2, weeks: 1, onlyCurrent: true, max: 2 })
  })
  it('пусто — без деления на ноль', () => {
    expect(rhythmChart([])).toMatchObject({ mode: 'total', total: 0, max: 1 })
    expect(rhythmChart(undefined).max).toBe(1)
  })
})

describe('подписи ритма', () => {
  it('среднее с запятой и правильным словом', () => {
    expect(fmtAvg(2.4)).toBe('2,4')
    expect(fmtAvg(3)).toBe('3')
    expect(avgWord(2.4)).toBe('тренировки')
    expect(avgWord(1)).toBe('тренировка')
    expect(avgWord(5)).toBe('тренировок')
  })
  it('понедельник как дд.мм — и у текущей недели тоже', () => {
    expect(mondayLabel(wk(1, { start: '2026-07-27' }))).toBe('27.07')
    expect(mondayLabel(wk(1, { current: true, start: '2026-09-28' }))).toBe('28.09')
    expect(mondayLabel({})).toBe('')
  })
})
