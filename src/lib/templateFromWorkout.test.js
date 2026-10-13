import { describe, it, expect } from 'vitest'
import { templateExercisesFromWorkout, defaultTemplateName } from './templateFromWorkout.js'
import { setsFromTemplate, applyProgIn, revertProgIn } from './workoutEntries.js'
import { cleanTemplateForExport } from './exportTemplate.js'

describe('точный снимок шаблона', () => {
  it.each([
    ['weight', [{ weight: 20, reps: 15 }, { weight: 82.5, reps: 8 }, { weight: 75, reps: 10 }]],
    ['reps', [{ weight: -30, reps: 12 }, { weight: 0, reps: 10 }, { weight: 12.5, reps: 6 }]],
    ['time', [{ weight: 0, reps: 60 }, { weight: 0, reps: 95 }]],
    ['distance', [{ weight: 2.5, reps: 900 }, { weight: 1, reps: 300 }]],
  ])('%s: все значения и порядок проходят создание → применение → экспорт', (metric, sets) => {
    const exercise = { id: 'e', metric }
    const [item] = templateExercisesFromWorkout([{ exercise, sets: sets.map((s) => ({ ...s, _k: 'ui' })) }])
    expect(item).toEqual({ exercise, metric, set_plan: sets })
    const restored = setsFromTemplate(exercise, item)
    expect(restored.map(({ weight, reps }) => ({ weight, reps }))).toEqual(sets)
    expect(new Set(restored.map((s) => s._k)).size).toBe(sets.length)
    expect(cleanTemplateForExport({ exercises: [item] }).exercises[0].set_plan).toEqual(sets)
    restored[0].reps = 1
    expect(item.set_plan).toEqual(sets)
  })
  it('не придумывает подходы и не принимает пустые значения', () => {
    expect(templateExercisesFromWorkout()).toEqual([])
    expect(templateExercisesFromWorkout([{ exercise: { id: 'e' }, sets: [] }, { sets: [{ weight: 20, reps: 10 }] }])).toEqual([])
    expect(() => templateExercisesFromWorkout([{ exercise: { id: 'e' }, sets: [{ weight: 20, reps: 0 }] }])).toThrow(/каждого подхода/)
  })
  it('ручная рекомендация и отмена возвращают исходный план, а не прошлую тренировку', () => {
    const sets = [{ weight: 20, reps: 15 }, { weight: 80, reps: 8 }]
    const entry = { sets, prog: { applied: false, prev: [{ weight: 60, reps: 10 }], recSets: [{ weight: 65, reps: 10 }] } }
    const applied = applyProgIn([entry], 0)
    expect(applied[0].sets[0].weight).toBe(65)
    expect(revertProgIn(applied, 0)[0].sets.map(({ weight, reps }) => ({ weight, reps }))).toEqual(sets)
    expect(entry.sets).toEqual(sets)
  })
})

describe('defaultTemplateName', () => {
  it('форматирует «Тренировка ДД.ММ» от даты', () => {
    // Местный полдень, а не '…T10:00Z': в UTC+14 это уже 15-е (РЕВЬЮ-КОДА-2026-10-02).
    expect(defaultTemplateName(new Date(2026, 6, 14, 12).toISOString())).toBe('Тренировка 14.07')
  })
  it('битая/пустая дата → сегодня (без падения)', () => {
    expect(defaultTemplateName('не-дата')).toMatch(/^Тренировка \d{2}\.\d{2}$/)
    expect(defaultTemplateName()).toMatch(/^Тренировка \d{2}\.\d{2}$/)
  })
})
