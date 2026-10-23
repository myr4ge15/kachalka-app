// Разминка и заминка (23.10.2026, fb_c2774110): блоки тренировки, перенос, порядок, заголовки; статистика —
// только основная часть.
import { describe, expect, it } from 'vitest'
import { orderByPhase, phaseHeading, phaseOf, phaseValue, reorderWithPhase, setEntryPhase } from './workoutPhases.js'
import { isMainEntry, mainEntries } from './entries.js'

const e = (id, phase) => (phase ? { exercise: { id }, phase } : { exercise: { id } })
const ids = (list) => list.map((x) => x.exercise.id)

describe('workoutPhases', () => {
  it('phaseOf / phaseValue: мусор и пусто — основная часть', () => {
    expect(phaseOf({ phase: 'warmup' })).toBe('warmup')
    expect(phaseOf({ phase: 'nope' })).toBe('main')
    expect(phaseOf(null)).toBe('main')
    expect(phaseValue('main')).toBeUndefined()
    expect(phaseValue('cooldown')).toBe('cooldown')
  })

  it('перенос — в конец своего блока; в основную — поле снимается', () => {
    const list = [e('w1', 'warmup'), e('a'), e('b'), e('c1', 'cooldown')]
    expect(ids(setEntryPhase(list, 2, 'warmup'))).toEqual(['w1', 'b', 'a', 'c1'])
    expect(setEntryPhase(list, 2, 'warmup')[1].phase).toBe('warmup')
    expect(ids(setEntryPhase(list, 1, 'cooldown'))).toEqual(['w1', 'b', 'c1', 'a'])
    const back = setEntryPhase(list, 0, 'main')
    expect(ids(back)).toEqual(['a', 'b', 'w1', 'c1'])
    expect('phase' in back[2]).toBe(false)
    expect(setEntryPhase(list, 1, 'main')).toBe(list) // уже там
    expect(setEntryPhase(list, 9, 'warmup')).toBe(list)
  })

  it('orderByPhase — устойчиво по блокам; уже по порядку — тот же массив', () => {
    const mixed = [e('a'), e('c', 'cooldown'), e('w', 'warmup'), e('b')]
    expect(ids(orderByPhase(mixed))).toEqual(['w', 'a', 'b', 'c'])
    const ok = [e('w', 'warmup'), e('a')]
    expect(orderByPhase(ok)).toBe(ok)
    expect(orderByPhase(null)).toEqual([])
  })

  it('заголовки — только когда блоков больше одного, у первого элемента блока', () => {
    const list = [e('w', 'warmup'), e('a'), e('b'), e('c', 'cooldown')]
    expect(list.map((_, i) => phaseHeading(list, i))).toEqual(['Разминка', 'Основная часть', null, 'Заминка'])
    expect(phaseHeading([e('a'), e('b')], 0)).toBeNull()
    expect(phaseHeading([e('w', 'warmup')], 0)).toBe('Разминка')
  })

  it('статистика — только основная часть', () => {
    const w = { entries: [e('w', 'warmup'), e('a'), e('c', 'cooldown')] }
    expect(ids(mainEntries(w))).toEqual(['a'])
    expect(isMainEntry({ phase: 'warmup' })).toBe(false)
    expect(mainEntries(null)).toEqual([])
  })
})

it('перетаскивание — блок по соседу: перед разминкой — в разминку, в конец — в блок последнего', () => {
  const list = [e('w', 'warmup'), e('a'), e('b'), e('c', 'cooldown')]
  const r1 = reorderWithPhase(list, 'b', 'w')
  expect(ids(r1)).toEqual(['b', 'w', 'a', 'c'])
  expect(r1[0].phase).toBe('warmup')
  const r2 = reorderWithPhase(list, 'a', null)
  expect(ids(r2)).toEqual(['w', 'b', 'c', 'a'])
  expect(r2[3].phase).toBe('cooldown')
  expect(reorderWithPhase(list, 'a', 'a')).toBe(list)
  expect(reorderWithPhase(list, 'x', 'a')).toBe(list)
  expect(reorderWithPhase(list, 'a', 'b')).toBe(list)
})
