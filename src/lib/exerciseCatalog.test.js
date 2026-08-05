import { describe, it, expect } from 'vitest'
import { canEditExercise, splitCatalog } from './exerciseCatalog.js'

const ME = 'u-me'
const OTHER = 'u-other'

describe('canEditExercise', () => {
  it('своё — можно', () => {
    expect(canEditExercise({ owner_id: ME }, ME)).toBe(true)
  })

  it('чужое — нельзя', () => {
    expect(canEditExercise({ owner_id: OTHER }, ME)).toBe(false)
  })

  it('ничьё (легаси без владельца) — можно: отбирать заведённое у людей не хотим', () => {
    expect(canEditExercise({ owner_id: null }, ME)).toBe(true)
    expect(canEditExercise({}, ME)).toBe(true)
  })

  it('нет упражнения — нельзя', () => {
    expect(canEditExercise(null, ME)).toBe(false)
  })
})

describe('splitCatalog', () => {
  it('режет список по владельцу, порядок внутри разделов сохраняет', () => {
    const list = [
      { id: '1', owner_id: ME },
      { id: '2', owner_id: OTHER },
      { id: '3', owner_id: ME },
      { id: '4', owner_id: null },
    ]
    const { mine, others } = splitCatalog(list, ME)
    expect(mine.map((e) => e.id)).toEqual(['1', '3'])
    expect(others.map((e) => e.id)).toEqual(['2', '4'])
  })

  it('ничьи уходят к «другим»: обещать «это добавил ты» без данных нельзя — это и был баг', () => {
    const { mine, others } = splitCatalog([{ id: '1' }, { id: '2', owner_id: null }], ME)
    expect(mine).toEqual([])
    expect(others).toHaveLength(2)
  })

  it('без userId (профиль ещё не подъехал) своих нет, а не «все мои»', () => {
    const { mine, others } = splitCatalog([{ id: '1', owner_id: ME }], undefined)
    expect(mine).toEqual([])
    expect(others).toHaveLength(1)
  })

  it('переживает пустой и не-массив', () => {
    expect(splitCatalog([], ME)).toEqual({ mine: [], others: [] })
    expect(splitCatalog(undefined, ME)).toEqual({ mine: [], others: [] })
  })
})
