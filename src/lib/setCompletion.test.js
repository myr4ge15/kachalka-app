import { describe, expect, it } from 'vitest'
import {
  allSetKeys, exerciseCompletion, isSetDone, keepDoneSets, remapExerciseKeys,
  setDoneKey, toggleDoneKey,
} from './setCompletion.js'

const bench = () => ({
  exercise: { id: 'bench', metric: 'weight' },
  sets: [{ weight: 60, reps: 8, _k: 'a' }, { weight: 60, reps: 7, _k: 'b' }],
})

describe('setDoneKey', () => {
  it('строит ключ из exercise.id и ключа строки подхода', () => {
    expect(setDoneKey('bench', { _k: 'a' }, 0)).toBe('bench::a')
  })

  it('для подхода без _k откатывается на индекс', () => {
    expect(setDoneKey('bench', {}, 2)).toBe('bench::i2')
  })
})

describe('toggleDoneKey', () => {
  it('отмечает и снимает отметку, не мутируя исходное множество', () => {
    const empty = new Set()
    const marked = toggleDoneKey(empty, 'bench::a')

    expect(marked.has('bench::a')).toBe(true)
    expect(empty.size).toBe(0)
    expect(toggleDoneKey(marked, 'bench::a').has('bench::a')).toBe(false)
  })

  it('работает от пустого состояния', () => {
    expect(toggleDoneKey(null, 'bench::a').has('bench::a')).toBe(true)
  })
})

describe('allSetKeys', () => {
  it('собирает ключи всех подходов состава (засев «всё выполнено»)', () => {
    expect(allSetKeys([bench(), {
      exercise: { id: 'pullup' },
      sets: [{ weight: 0, reps: 12, _k: 'c' }],
    }])).toEqual(['bench::a', 'bench::b', 'pullup::c'])
  })

  it('устойчив к пустому и битому составу', () => {
    expect(allSetKeys(null)).toEqual([])
    expect(allSetKeys([{ exercise: null, sets: null }])).toEqual([])
  })
})

describe('remapExerciseKeys', () => {
  it('переносит отметки на новый id и не трогает чужие', () => {
    const next = remapExerciseKeys(new Set(['bench::a', 'bench::b', 'pullup::c']), 'bench', 'db')

    expect([...next].sort()).toEqual(['db::a', 'db::b', 'pullup::c'])
  })

  it('«заменить» сохраняет подходы — значит и готовность упражнения', () => {
    const replaced = { ...bench(), exercise: { id: 'db', metric: 'weight' } }
    const done = remapExerciseKeys(new Set(['bench::a', 'bench::b']), 'bench', 'db')

    expect(exerciseCompletion(replaced, done)).toMatchObject({ doneCount: 2, allDone: true })
  })

  it('ничего не делает без отметок или при том же id', () => {
    const keys = new Set(['bench::a'])

    expect(remapExerciseKeys(keys, 'bench', 'bench')).toBe(keys)
    expect(remapExerciseKeys(null, 'bench', 'db').size).toBe(0)
    expect(remapExerciseKeys(keys, 'bench', null)).toBe(keys)
  })
})

describe('keepDoneSets', () => {
  it('оставляет только отмеченные подходы, не трогая их значения', () => {
    expect(keepDoneSets([bench()], new Set(['bench::a']))).toEqual([{
      exercise: { id: 'bench', metric: 'weight' },
      sets: [{ weight: 60, reps: 8, _k: 'a' }],
    }])
  })

  it('выбрасывает упражнение, у которого не отмечен ни один подход', () => {
    const pullup = { exercise: { id: 'pullup' }, sets: [{ weight: 0, reps: 12, _k: 'c' }] }

    expect(keepDoneSets([bench(), pullup], new Set(['pullup::c'])))
      .toEqual([pullup])
    expect(keepDoneSets([bench()], new Set())).toEqual([])
  })

  it('не мутирует исходный состав', () => {
    const entries = [bench()]
    keepDoneSets(entries, new Set(['bench::a']))
    expect(entries[0].sets).toHaveLength(2)
  })

  it('устойчив к пустому и битому составу', () => {
    expect(keepDoneSets(null, new Set())).toEqual([])
    expect(keepDoneSets([{ exercise: null, sets: null }], new Set())).toEqual([])
  })
})

describe('exerciseCompletion', () => {
  it('считает отмеченные подходы текущего состава', () => {
    expect(exerciseCompletion(bench(), new Set(['bench::a']))).toEqual({
      setCount: 2, doneCount: 1, allDone: false,
    })
    expect(exerciseCompletion(bench(), new Set(['bench::a', 'bench::b']))).toEqual({
      setCount: 2, doneCount: 2, allDone: true,
    })
  })

  it('игнорирует ключи подходов, которых в составе больше нет', () => {
    expect(exerciseCompletion(bench(), new Set(['bench::a', 'bench::gone']))).toEqual({
      setCount: 2, doneCount: 1, allDone: false,
    })
  })

  it('без отметок и без подходов не считает упражнение выполненным', () => {
    expect(exerciseCompletion(bench(), null)).toMatchObject({ doneCount: 0, allDone: false })
    expect(exerciseCompletion({ exercise: { id: 'x' }, sets: [] }, new Set(['x::a'])))
      .toMatchObject({ setCount: 0, allDone: false })
  })

  it('isSetDone отвечает по конкретному подходу', () => {
    const keys = new Set(['bench::b'])
    expect(isSetDone(keys, 'bench', { _k: 'a' }, 0)).toBe(false)
    expect(isSetDone(keys, 'bench', { _k: 'b' }, 1)).toBe(true)
  })
})
