import { describe, expect, it } from 'vitest'
import { fmtSet, setTonnage } from './metric.js'
import { loadValue, personalLoadGain, storedSet, withLoad } from './setLoad.js'
import { savableSet } from './setLimits.js'
import { workoutFinishSummary } from './workoutFinish.js'
import { buildRecommendation } from './progressionCard.js'
import { hasBlockInWindow } from './insights.js'
import { addSetIn, stepSetIn, updateSetIn, setsFromTemplate } from './workoutEntries.js'

const ex = { id: 'lat', metric: 'weight' }
const set = (unit, value, reps = 10) => withLoad({ reps }, unit, value)
const entry = (...sets) => ({ exercise: ex, sets })
const workout = (...sets) => ({ entries: [entry(...sets)], performed_at: '2026-11-20' })

describe('личные единицы весового подхода', () => {
  it('оставляет исходную запись рядом с килограммами, включая старые подходы', () => {
    expect(savableSet(set('lb', '100', 10))).toEqual({ weight: 45.36, reps: 10, load_input: { unit: 'lb', value: 100 } })
    expect(storedSet({ weight: '20', reps: '8' })).toEqual({ weight: 20, reps: 8 })
    const block = savableSet(set('block', 7, 12))
    expect(setTonnage('weight', block)).toBe(0)
    expect(fmtSet('weight', storedSet(block))).toBe('Номер блока 7 × 12')
    expect(withLoad(block, 'kg', 7)).toEqual({ weight: 7, reps: 12 })
  })
  it('отсекает незаполненные, дробные номера блоков и чрезмерный вес', () => {
    for (const invalid of ['', -1, 0, 2.5, 1001, 'abc']) expect(savableSet(set('block', invalid))).toBeNull()
    for (const invalid of [2204.63, -1, Infinity]) expect(savableSet(set('lb', invalid))).toBeNull()
    expect(savableSet(set('lb', '12,5')).load_input.value).toBe(12.5)
  })
  it('подставляет исходное показание из личной истории и редактирует его в этой единице', () => {
    const previous = set('block', 7)
    const sessions = [{ sets: [previous], metric: 'weight' }]
    const built = buildRecommendation(ex, sessions, { enabled: true })
    expect(built.meta.prev).toEqual([previous])
    const rows = stepSetIn([entry(...built.sets)], 0, 0, 'weight', 1)
    expect(loadValue(rows[0].sets[0])).toBe(8)
    expect(addSetIn(rows, 0)[0].sets.map(loadValue)).toEqual([8, 8])
    expect(updateSetIn(rows, 0, 0, 'weight', '4')[0].sets[0]).toMatchObject({ weight: 0, load_input: { value: '4' } })
    expect(setsFromTemplate(ex, { sets: 2, reps: 12 }, sessions).map(loadValue)).toEqual([7, 7])
  })
  it('разделяет известный тоннаж и номера блоков; исключает разминку и секунды', () => {
    const mixed = workout(set('kg', 45), set('lb', 100), set('block', 7, 12))
    mixed.entries.push({ ...entry(set('kg', 20)), phase: 'warmup' }, { exercise: { metric: 'time' }, sets: [{ weight: 0, reps: 90 }] })
    expect(workoutFinishSummary(mixed)).toMatchObject({ workingSets: 4, repetitions: 32, tonnage: 903.6, blocks: 1, loadSets: 3 })
    expect(workoutFinishSummary(workout(set('block', 8)))).toMatchObject({ tonnage: 0, blocks: 1, repetitions: 10 })
    expect(hasBlockInWindow([mixed], new Date('2026-11-26'), 60)).toBe(true)
    expect(hasBlockInWindow([mixed], new Date('2027-11-26'), 60)).toBe(false)
  })
  it('сравнивает личные подходы только в совместимых единицах и условиях', () => {
    expect(personalLoadGain([set('block', 7, 12)], [set('block', 7, 10)])?.delta).toBe(2)
    expect(personalLoadGain([set('lb', 100)], [set('lb', 90), set('lb', 85)])?.delta).toBe(10)
    expect(personalLoadGain([set('block', 8)], [set('block', 7)])).toBeNull()
    expect(personalLoadGain([set('kg', 100), set('lb', 80)], [set('lb', 90)])).toBeNull()
    expect(personalLoadGain([set('lb', 100)], [set('block', 7)])).toBeNull()
  })
})
