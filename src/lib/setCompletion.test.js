import { describe, expect, it } from 'vitest'
import {
  allSetKeys, exerciseCompletion, isSetDone, setDoneKey, toggleDoneKey,
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
