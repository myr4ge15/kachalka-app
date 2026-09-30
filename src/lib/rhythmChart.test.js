import { describe, it, expect } from 'vitest'
import { rhythmChart, fmtAvg, avgWord, mondayLabel } from './rhythmChart.js'

const wk = (count, current = false, start = '2026-09-07') => ({ count, current, start })

describe('rhythmChart', () => {
  it('среднее — по завершённым неделям, текущая не занижает', () => {
    const r = rhythmChart([wk(2), wk(3), wk(2), wk(0, true)])
    expect(r.avg).toBe(2.3)
    expect(r.avgWeeks).toBe(3)
    expect(r.max).toBe(3)
  })
  it('без завершённых недель — по тому, что есть; пусто — без деления на ноль', () => {
    expect(rhythmChart([wk(1, true)])).toEqual({ avg: 1, max: 1, avgWeeks: 1 })
    expect(rhythmChart([])).toEqual({ avg: 0, max: 1, avgWeeks: 0 })
    expect(rhythmChart(undefined).max).toBe(1)
  })
  it('текущая неделя может задавать максимум шкалы', () => {
    expect(rhythmChart([wk(1), wk(4, true)]).max).toBe(4)
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
  it('понедельник как дд.мм, текущая — «эта»', () => {
    expect(mondayLabel(wk(1, false, '2026-07-27'))).toBe('27.07')
    expect(mondayLabel(wk(1, true))).toBe('эта')
    expect(mondayLabel({})).toBe('')
  })
})
