// Изометрия (23.10.2026, ответы Ильи fb_c2774110): у «На время» — необязательный вес снаряда (не меньше 0),
// рекорд — по времени (вес — условие, на время не умножаем), объем — время под нагрузкой, прогрессия
// «+5 с» переносит вес снаряда, замена упражнения на другое «На время» вес сохраняет.
import { describe, expect, it } from 'vitest'
import { fmtSet, hasLoadWeight, hasExtraWeight, leadingValue, setTimeUnderLoad, setTonnage } from './metric.js'
import { replaceExerciseIn } from './workoutEntries.js'
import { workoutFinishSummary } from './workoutFinish.js'
import { recommendProgression } from './progression.js'

describe('изометрия: вес снаряда у «На время»', () => {
  it('вес снаряда — только у «На время», это не доп. вес «своего веса»', () => {
    expect(hasLoadWeight('time')).toBe(true)
    expect(hasLoadWeight('reps')).toBe(false)
    expect(hasExtraWeight('time')).toBe(false)
  })

  it('подпись подхода: «10 кг · 1:30», без веса — «1:30»', () => {
    expect(fmtSet('time', { weight: 10, reps: 90 })).toBe('10 кг · 1:30')
    expect(fmtSet('time', { weight: 2.5, reps: 45 })).toBe('2.5 кг · 0:45')
    expect(fmtSet('time', { weight: 0, reps: 60 })).toBe('1:00')
  })

  it('рекорд — дольше, вес не умножаем; тоннажа нет, объем — время под нагрузкой', () => {
    const sets = [{ weight: 50, reps: 90 }, { weight: 60, reps: 60 }]
    expect(leadingValue('time', sets)).toBe(90)
    expect(setTonnage('time', sets[0])).toBe(0)
    expect(setTimeUnderLoad('time', sets[0]) + setTimeUnderLoad('time', sets[1])).toBe(150)
    expect(setTimeUnderLoad('weight', { weight: 50, reps: 10 })).toBe(0)
  })

  it('итог тренировки — время под нагрузкой суммой', () => {
    const workout = { entries: [
      { exercise: { id: 'p', name: 'Планка', metric: 'time' }, sets: [{ weight: 10, reps: 90 }, { weight: 0, reps: 60 }] },
      { exercise: { id: 'b', name: 'Жим', metric: 'weight' }, sets: [{ weight: 80, reps: 5 }] },
    ] }
    const s = workoutFinishSummary(workout)
    expect(s.timeUnderLoad).toBe(150)
    expect(s.tonnage).toBe(400)
  })

  it('замена на другое «На время» сохраняет вес снаряда, на «свой вес» — обнуляет', () => {
    const entries = [{ exercise: { id: 'p', metric: 'time' }, sets: [{ weight: 10, reps: 90 }] }]
    expect(replaceExerciseIn(entries, 0, { id: 's', metric: 'time' })[0].sets[0].weight).toBe(10)
    expect(replaceExerciseIn(entries, 0, { id: 'r', metric: 'reps' })[0].sets[0].weight).toBe(0)
  })
})

describe('изометрия: прогрессия', () => {
  it('«+5 с сверху» и вес снаряда переносится', () => {
    const prev = [{ weight: 10, reps: 60 }, { weight: 10, reps: 60 }]
    const r = recommendProgression({ lastSets: prev, metric: 'time' })
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([{ weight: 10, reps: 65 }, { weight: 10, reps: 65 }])
  })
})
