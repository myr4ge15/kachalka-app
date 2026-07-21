import { describe, it, expect } from 'vitest'
import {
  buildRecommendation,
  defaultSet,
  daysAgoLabel,
  progArrow,
  progTone,
  progStepUnit,
  progStepMin,
  nextProgStep,
  fmtProgStep,
} from './progressionCard.js'

const ex = (over = {}) => ({ id: 'e1', name: 'Жим', metric: 'weight', ...over })
const s = (weight, reps) => ({ weight, reps })
const sess = (sets, performed_at = '2026-01-01T10:00:00.000Z') => ({ performed_at, sets })
// progState по умолчанию — глобально включено, без пер-упражненческих оверрайдов
const on = (byExercise = {}) => ({ enabled: true, byExercise })

describe('defaultSet', () => {
  it('весовое → 20×10', () => {
    const d = defaultSet(ex())
    expect(d.weight).toBe(20)
    expect(d.reps).toBe(10)
    expect(d._k).toBeTruthy()
  })
  it('reps → 0×10', () => {
    expect(defaultSet(ex({ metric: 'reps' }))).toMatchObject({ weight: 0, reps: 10 })
  })
  it('time → 0×60с', () => {
    expect(defaultSet(ex({ metric: 'time' }))).toMatchObject({ weight: 0, reps: 60 })
  })
  it('_k уникальны', () => {
    expect(defaultSet(ex())._k).not.toBe(defaultSet(ex())._k)
  })
})

describe('форматтеры панели', () => {
  it('progArrow / progTone по ветке', () => {
    expect(progArrow('up')).toBe('↗')
    expect(progArrow('nudge')).toBe('↗')
    expect(progArrow('down')).toBe('↘')
    expect(progArrow('same')).toBe('=')
    expect(progTone('up')).toBe('up')
    expect(progTone('nudge')).toBe('up')
    expect(progTone('down')).toBe('down')
    expect(progTone('same')).toBe('same')
  })
  it('единицы и шаг по метрике', () => {
    expect(progStepUnit('weight')).toBe('кг')
    expect(progStepUnit('reps')).toBe('повт.')
    expect(progStepUnit('time')).toBe('с')
    expect(progStepMin('weight')).toBe(1.25)
    expect(progStepMin('reps')).toBe(1)
    expect(progStepMin('time')).toBe(5)
  })
  it('nextProgStep — дискретный шаг, не ниже минимума', () => {
    expect(nextProgStep(2.5, 'weight', +1)).toBe(3.75)
    expect(nextProgStep(1.25, 'weight', -1)).toBe(1.25) // не ниже min
    expect(nextProgStep(10, 'time', +1)).toBe(15)
  })
  it('fmtProgStep', () => {
    expect(fmtProgStep(2.5, 'weight')).toBe('2.5 кг')
    expect(fmtProgStep(5, 'time')).toBe('5 с')
  })
  it('daysAgoLabel', () => {
    const iso = (d) => new Date(Date.now() - d * 86400000).toISOString()
    expect(daysAgoLabel(iso(0))).toBe('сегодня')
    expect(daysAgoLabel(iso(1))).toBe('вчера')
    expect(daysAgoLabel(iso(3))).toBe('3 дня назад')
    expect(daysAgoLabel(iso(5))).toBe('5 дней назад')
    expect(daysAgoLabel(null)).toBe('')
  })
})

describe('buildRecommendation', () => {
  it('глобально выключено → meta:null, копия прошлого', () => {
    const r = buildRecommendation(ex(), [sess([s(50, 8)])], { enabled: false, byExercise: {} })
    expect(r.meta).toBeNull()
    expect(r.sets).toHaveLength(1)
    expect(r.sets[0]).toMatchObject({ weight: 50, reps: 8 })
  })

  it('нет истории при активной стратегии → meta:null, дефолт', () => {
    const r = buildRecommendation(ex(), [], on())
    expect(r.meta).toBeNull()
    expect(r.sets[0]).toMatchObject({ weight: 20, reps: 10 })
  })

  it('стратегия manual → muted-панель + копия прошлого', () => {
    const r = buildRecommendation(ex(), [sess([s(50, 10)])], on({ e1: { strategy: 'manual' } }))
    expect(r.meta).toMatchObject({ muted: true, strategy: 'manual' })
    expect(r.meta.prev).toEqual([{ weight: 50, reps: 10 }])
    expect(r.sets[0]).toMatchObject({ weight: 50, reps: 10 })
  })

  it('стратегия off → muted-панель', () => {
    const r = buildRecommendation(ex(), [sess([s(50, 10)])], on({ e1: { strategy: 'off' } }))
    expect(r.meta).toMatchObject({ muted: true, strategy: 'off' })
  })

  it('всё выполнено (+вес) → ветка up с рекомендацией и applied', () => {
    // весовая цель по первому рабочему подходу = 10 повт., оба подхода закрыты
    const r = buildRecommendation(ex(), [sess([s(50, 10), s(50, 10)])], on({ e1: { strategy: 'weight', step: 2.5 } }))
    expect(r.meta).toMatchObject({ muted: false, kind: 'up', applied: true })
    expect(r.meta.prev).toEqual([{ weight: 50, reps: 10 }, { weight: 50, reps: 10 }])
    expect(r.meta.recSets[0].weight).toBe(52.5)
    // предзаполненные подходы несут _k для React-ключей
    expect(r.sets.every((x) => x._k)).toBe(true)
  })

  it('не добил повторы → ветка same, вес тот же', () => {
    const r = buildRecommendation(ex(), [sess([s(50, 10), s(50, 6)])], on({ e1: { strategy: 'weight', step: 2.5 } }))
    expect(r.meta.kind).toBe('same')
    expect(r.meta.recSets.every((x) => x.weight === 50)).toBe(true)
  })
})
