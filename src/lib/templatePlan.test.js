import { describe, it, expect } from 'vitest'
import { templatePlan, cleanTemplatePlan } from './templatePlan.js'

const bench = { id: 'b', name: 'Жим', metric: 'weight' }
const plank = { id: 'p', name: 'Планка', metric: 'time' }
const run = { id: 'r', name: 'Бег', metric: 'distance' }

describe('templatePlan — детальный план или развертка старых целей', () => {
  it('детальный план копируется, а не отдается по ссылке', () => {
    const item = { set_plan: [{ weight: 60, reps: 8 }, { weight: 70, reps: 5 }] }
    const plan = templatePlan(bench, item)
    expect(plan).toEqual(item.set_plan)
    plan[0].weight = 1
    expect(item.set_plan[0].weight).toBe(60)
  })
  it('старые цели sets×reps×weight разворачиваются в одинаковые подходы', () => {
    expect(templatePlan(bench, { sets: 3, reps: 5, weight: 100 })).toEqual([
      { weight: 100, reps: 5 }, { weight: 100, reps: 5 }, { weight: 100, reps: 5 },
    ])
  })
  it('без целей — один подход с дефолтом метрики', () => {
    expect(templatePlan(bench, {})).toEqual([{ weight: 20, reps: 10 }])
    expect(templatePlan(plank, null)).toEqual([{ weight: 0, reps: 60 }])
    expect(templatePlan(run, undefined)).toEqual([{ weight: 0, reps: 1800 }])
  })
  it('мусорное число подходов → хотя бы один, не больше 1000', () => {
    expect(templatePlan(bench, { sets: 'abc', reps: 5, weight: 50 })).toHaveLength(1)
    expect(templatePlan(bench, { sets: 5000, reps: 5, weight: 50 })).toHaveLength(1000)
  })
})

describe('cleanTemplatePlan', () => {
  it('«На время» хранит вес снаряда (изометрия; сервер принимает с …_workout_phases.sql)', () => {
    expect(cleanTemplatePlan([{ weight: 10, reps: 90 }], 'time')).toEqual([{ weight: 10, reps: 90 }])
  })
  it('пустой или слишком длинный план — ошибка', () => {
    expect(() => cleanTemplatePlan([], 'weight')).toThrow(/от 1 до 1000/)
    expect(() => cleanTemplatePlan(null, 'weight')).toThrow(/от 1 до 1000/)
    expect(() => cleanTemplatePlan(Array.from({ length: 1001 }, () => ({ weight: 1, reps: 1 })), 'weight')).toThrow(/от 1 до 1000/)
  })
  it('незаполненный подход — ошибка, заполненные проходят', () => {
    expect(() => cleanTemplatePlan([{ weight: 50, reps: 0 }], 'weight')).toThrow(/Заполни/)
    expect(cleanTemplatePlan([{ weight: 50, reps: 5 }], 'weight')).toHaveLength(1)
  })
})
