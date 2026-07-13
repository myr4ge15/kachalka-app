import { describe, it, expect } from 'vitest'
import {
  SUBMUSCLES,
  MAJOR_DEFAULT_SUB,
  SECONDARY_LOAD_FACTOR,
  DEFAULT_SUB_RECOVERY_HOURS,
  isKnownSub,
  majorOf,
  submusclesOf,
  defaultSubmuscleFor,
  recoveryHoursFor,
  labelOf,
  labelAccusativeOf,
  secondaryOptionsFor,
  cleanSecondary,
  SUBMUSCLE_SLUGS,
} from './muscles.js'
import { GROUP_ORDER } from './dayTags.js'

// Крупные группы таксономии (кардио — свободная, не в GROUP_ORDER, но валидна).
const KNOWN_MAJORS = new Set([...GROUP_ORDER, 'кардио'])

describe('muscles — таксономия', () => {
  it('каждая подмышца привязана к известной крупной группе', () => {
    for (const [slug, def] of Object.entries(SUBMUSCLES)) {
      expect(KNOWN_MAJORS.has(def.major), `${slug} → ${def.major}`).toBe(true)
    }
  })

  it('у каждой подмышцы положительный порог восстановления и подписи', () => {
    for (const [slug, def] of Object.entries(SUBMUSCLES)) {
      expect(def.recoveryHours, slug).toBeGreaterThan(0)
      expect(typeof def.label, slug).toBe('string')
      expect(def.label.length, slug).toBeGreaterThan(0)
      expect(typeof def.labelAccusative, slug).toBe('string')
    }
  })

  it('дефолтная подмышца каждой группы — валидный слаг своей группы', () => {
    for (const [major, slug] of Object.entries(MAJOR_DEFAULT_SUB)) {
      expect(isKnownSub(slug), `${major} → ${slug}`).toBe(true)
      expect(majorOf(slug), `${major} → ${slug}`).toBe(major)
    }
  })

  it('у каждой крупной группы (кроме своих) есть дефолтная подмышца', () => {
    for (const major of [...GROUP_ORDER, 'кардио']) {
      expect(defaultSubmuscleFor(major), major).not.toBeNull()
    }
  })
})

describe('muscles — хелперы', () => {
  it('majorOf: известный слаг → группа, неизвестный → null', () => {
    expect(majorOf('quads')).toBe('ноги')
    expect(majorOf('delt_rear')).toBe('плечи')
    expect(majorOf('нет-такого')).toBeNull()
    expect(majorOf(undefined)).toBeNull()
  })

  it('submusclesOf: возвращает все подмышцы группы в порядке объявления', () => {
    expect(submusclesOf('ноги')).toEqual(['quads', 'hamstrings', 'glutes', 'calves', 'adductors'])
    expect(submusclesOf('трицепс')).toEqual(['triceps'])
    expect(submusclesOf('неизвестная')).toEqual([])
  })

  it('recoveryHoursFor: значение подмышцы, неизвестный → общий дефолт', () => {
    expect(recoveryHoursFor('quads')).toBe(72)
    expect(recoveryHoursFor('abs_rectus')).toBe(24)
    expect(recoveryHoursFor('нет')).toBe(DEFAULT_SUB_RECOVERY_HOURS)
    expect(recoveryHoursFor(null)).toBe(DEFAULT_SUB_RECOVERY_HOURS)
  })

  it('defaultSubmuscleFor: группа → слаг, неизвестная → null', () => {
    expect(defaultSubmuscleFor('спина')).toBe('lats')
    expect(defaultSubmuscleFor('нет')).toBeNull()
  })

  it('подписи: известный → label, неизвестный → сам слаг', () => {
    expect(labelOf('glutes')).toBe('ягодичные')
    expect(labelAccusativeOf('traps')).toBe('трапецию')
    expect(labelOf('xxx')).toBe('xxx')
    expect(labelAccusativeOf('xxx')).toBe('xxx')
  })

  it('SECONDARY_LOAD_FACTOR в диапазоне (0,1)', () => {
    expect(SECONDARY_LOAD_FACTOR).toBeGreaterThan(0)
    expect(SECONDARY_LOAD_FACTOR).toBeLessThan(1)
  })

  it('secondaryOptionsFor: все подмышцы кроме основной и кардио', () => {
    const opts = secondaryOptionsFor('biceps')
    expect(opts).not.toContain('biceps')
    expect(opts).not.toContain('cardio')
    expect(opts).toContain('triceps')
    expect(opts).toContain('delt_front')
    // порядок сохраняется как в SUBMUSCLE_SLUGS
    expect(opts).toEqual(SUBMUSCLE_SLUGS.filter((s) => s !== 'biceps' && s !== 'cardio'))
  })

  it('cleanSecondary: чистит неизвестные/дубли/основную/кардио, сохраняет порядок', () => {
    expect(cleanSecondary(['triceps', 'delt_front', 'triceps', 'xxx', 'cardio', 'quads'], 'quads'))
      .toEqual(['delt_front', 'triceps']) // порядок SUBMUSCLE_SLUGS: delt_front раньше triceps
    expect(cleanSecondary(null, 'biceps')).toEqual([])
    expect(cleanSecondary(['biceps'], 'biceps')).toEqual([])
  })
})
