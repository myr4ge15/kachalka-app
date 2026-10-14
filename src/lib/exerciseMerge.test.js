import { describe, it, expect } from 'vitest'
import { isMergedAlias, mergeSources, mergeTargets, mergedSummary } from './exerciseMerge.js'

const EX = [
  { id: 'shared', name: 'Тяга верхнего блока', is_custom: false },
  { id: 'shared2', name: 'Жим лежа', is_custom: false },
  { id: 'mine', name: 'Моя тяга', is_custom: true },
  { id: 'hidden', name: 'Убрано из пикера', is_custom: false, is_hidden: true },
  { id: 'a1', name: 'Тяга верхнего блока', is_custom: false, is_hidden: true, merged_into: 'shared' },
  { id: 'a2', name: 'Тяга верхнего блока', is_custom: false, is_hidden: true, merged_into: 'shared' },
  { id: 'a3', name: 'Жим лежа', is_custom: true, is_hidden: true, merged_into: 'shared2' },
]
const ids = (l) => l.map((e) => e.id)

describe('слияние дублей — правила выбора (v8.2.0)', () => {
  it('алиас — строка с merged_into', () => {
    expect(isMergedAlias(EX[4])).toBe(true)
    expect(isMergedAlias(EX[3])).toBe(false)
    expect(isMergedAlias(null)).toBe(false)
  })

  it('источник: всё, кроме уже слитого (скрытое из пикера — можно)', () => {
    expect(ids(mergeSources(EX))).toEqual(['shared', 'shared2', 'mine', 'hidden'])
    expect(mergeSources(undefined)).toEqual([])
  })

  it('цель: видимая, не алиас, не сама; общее — только в общее', () => {
    expect(ids(mergeTargets(EX, 'mine'))).toEqual(['shared', 'shared2']) // свое → общее можно
    expect(ids(mergeTargets(EX, 'shared'))).toEqual(['shared2']) // общее → свое нельзя
    expect(ids(mergeTargets(EX, 'hidden'))).toEqual(['shared', 'shared2'])
    expect(ids(mergeTargets(EX, ''))).toEqual(['shared', 'shared2', 'mine']) // источник не выбран
  })

  it('сводка слитых: по основному упражнению, больше слитых — выше', () => {
    expect(mergedSummary(EX)).toEqual([
      { id: 'shared', name: 'Тяга верхнего блока', count: 2 },
      { id: 'shared2', name: 'Жим лежа', count: 1 },
    ])
    expect(mergedSummary([{ id: 'x', name: 'Сирота', merged_into: 'нет' }])).toEqual([{ id: 'нет', name: 'Сирота', count: 1 }])
    expect(mergedSummary([])).toEqual([])
  })
})
