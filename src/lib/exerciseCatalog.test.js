import { describe, it, expect } from 'vitest'
import { canEditExercise, splitCatalog } from './exerciseCatalog.js'

const ME = 'u-me'
const OTHER = 'u-other'

const custom = (id, owner) => ({ id, is_custom: true, owner_id: owner })
const global_ = (id) => ({ id, is_custom: false, owner_id: null })

describe('canEditExercise', () => {
  it('своё кастомное — можно', () => {
    expect(canEditExercise(custom('1', ME), ME)).toBe(true)
  })

  it('чужое — нельзя', () => {
    expect(canEditExercise(custom('1', OTHER), ME)).toBe(false)
  })

  // Ровно та дыра, из-за которой member мог править общий справочник: до среза D
  // ничьё считалось «можно», и карандаш появлялся у 36 упражнений круга.
  it('общее (is_custom = false) — нельзя даже владельцу-админу: правит admin-RPC', () => {
    expect(canEditExercise(global_('1'), ME)).toBe(false)
  })

  it('кастомное без владельца — нельзя: ничьё = общее', () => {
    expect(canEditExercise(custom('1', null), ME)).toBe(false)
    expect(canEditExercise({ id: '1', is_custom: true }, ME)).toBe(false)
  })

  it('нет упражнения или нет пользователя — нельзя', () => {
    expect(canEditExercise(null, ME)).toBe(false)
    expect(canEditExercise(custom('1', ME), undefined)).toBe(false)
  })
})

describe('splitCatalog', () => {
  it('режет справочник на три раздела, порядок внутри сохраняет', () => {
    const list = [
      custom('1', ME),
      custom('2', OTHER),
      custom('3', ME),
      global_('4'),
    ]
    const { mine, others, global } = splitCatalog(list, ME)
    expect(mine.map((e) => e.id)).toEqual(['1', '3'])
    expect(others.map((e) => e.id)).toEqual(['2'])
    expect(global.map((e) => e.id)).toEqual(['4'])
  })

  it('кастомное без владельца (окно раскатки) уходит к общим, а не к «моим»', () => {
    const { mine, others, global } = splitCatalog([custom('1', null)], ME)
    expect(mine).toEqual([])
    expect(others).toEqual([])
    expect(global).toHaveLength(1)
  })

  it('без userId (профиль ещё не подъехал) своих нет, а не «все мои»', () => {
    const { mine, others } = splitCatalog([custom('1', ME)], undefined)
    expect(mine).toEqual([])
    expect(others).toHaveLength(1)
  })

  it('переживает пустой и не-массив', () => {
    expect(splitCatalog([], ME)).toEqual({ mine: [], others: [], global: [] })
    expect(splitCatalog(undefined, ME)).toEqual({ mine: [], others: [], global: [] })
  })
})
