import { describe, it, expect } from 'vitest'
import { NOTIF_CATEGORIES, notifCategory, filterNotifs, activeCategories } from './notifFilter.js'

const n = (type, at = '2026-07-10') => ({ type, at, id: `${type}:${at}` })

describe('notifCategory', () => {
  it('сводит пять типов к четырём группам', () => {
    expect(notifCategory('mine')).toBe('records')
    expect(notifCategory('goal')).toBe('records')
    expect(notifCategory('beaten')).toBe('beaten')
    expect(notifCategory('reaction')).toBe('reactions')
    expect(notifCategory('insight')).toBe('insights')
  })
  it('неизвестный тип → records (консервативно)', () => {
    expect(notifCategory('weird')).toBe('records')
    expect(notifCategory(undefined)).toBe('records')
  })
})

describe('filterNotifs', () => {
  const list = [n('mine'), n('goal'), n('beaten'), n('reaction'), n('insight')]
  it("'all'/пусто → без изменений", () => {
    expect(filterNotifs(list, 'all')).toHaveLength(5)
    expect(filterNotifs(list, undefined)).toHaveLength(5)
    expect(filterNotifs(list, '')).toHaveLength(5)
  })
  it('records включает и mine, и goal', () => {
    expect(filterNotifs(list, 'records').map((x) => x.type)).toEqual(['mine', 'goal'])
  })
  it('прочие категории — по одному', () => {
    expect(filterNotifs(list, 'beaten').map((x) => x.type)).toEqual(['beaten'])
    expect(filterNotifs(list, 'reactions').map((x) => x.type)).toEqual(['reaction'])
    expect(filterNotifs(list, 'insights').map((x) => x.type)).toEqual(['insight'])
  })
  it('пустой/undefined список не падает', () => {
    expect(filterNotifs(null, 'records')).toEqual([])
    expect(filterNotifs(undefined, 'all')).toEqual([])
  })
})

describe('activeCategories', () => {
  it('только присутствующие категории + всегда all, порядок сохранён', () => {
    const cats = activeCategories([n('reaction'), n('mine')])
    expect(cats.map((c) => c.key)).toEqual(['all', 'records', 'reactions'])
  })
  it('пустой список → только all', () => {
    expect(activeCategories([]).map((c) => c.key)).toEqual(['all'])
    expect(activeCategories(null).map((c) => c.key)).toEqual(['all'])
  })
  it('полный набор → все чипы в каноничном порядке', () => {
    const cats = activeCategories([n('mine'), n('beaten'), n('reaction'), n('insight')])
    expect(cats.map((c) => c.key)).toEqual(NOTIF_CATEGORIES.map((c) => c.key))
  })
})
