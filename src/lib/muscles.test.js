import { describe, it, expect } from 'vitest'
import {
  SUBMUSCLES,
  MAJOR_DEFAULT_SUB,
  SECONDARY_LOAD_FACTOR,
  DEFAULT_SUB_RECOVERY_HOURS,
  isKnownSub,
  isMinorSub,
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

// Крупные группы таксономии. Помимо канонических GROUP_ORDER в реальной базе как
// отдельные major живут «ягодицы» и «трапеции» (+ свободная «кардио»).
const KNOWN_MAJORS = new Set([...GROUP_ORDER, 'кардио', 'ягодицы', 'трапеции'])

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
    for (const major of [...GROUP_ORDER, 'кардио', 'ягодицы', 'трапеции']) {
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
    expect(submusclesOf('ноги')).toEqual(['quads', 'hamstrings', 'calves', 'adductors'])
    expect(submusclesOf('ягодицы')).toEqual(['glute_max', 'glute_med'])
    expect(submusclesOf('трапеции')).toEqual(['traps'])
    expect(submusclesOf('спина')).toEqual(['lats', 'rhomboids', 'lower_back'])
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

  it('новые слаги груди/пресса (PLAN-exercises-base)', () => {
    // грудь: chest_middle — новый стандарт плоских жимов, стала дефолтом группы
    expect(isKnownSub('chest_middle')).toBe(true)
    expect(majorOf('chest_middle')).toBe('грудь')
    expect(defaultSubmuscleFor('грудь')).toBe('chest_middle')
    expect(recoveryHoursFor('chest_middle')).toBe(48)
    // serratus — тоже грудь
    expect(majorOf('serratus')).toBe('грудь')
    expect(submusclesOf('грудь')).toEqual(['chest_upper', 'chest_middle', 'chest_lower', 'serratus'])
    // chest_lower сохранён (совместимость исторических снимков), но не дефолт
    expect(isKnownSub('chest_lower')).toBe(true)
    // hip_flexors — primary подъёмов ног, major пресс, быстрое восстановление
    expect(majorOf('hip_flexors')).toBe('пресс')
    expect(recoveryHoursFor('hip_flexors')).toBe(24)
    expect(submusclesOf('пресс')).toEqual(['abs_rectus', 'abs_obliques', 'hip_flexors'])
    // новые слаги предлагаются во вторичные
    const opts = secondaryOptionsFor('biceps')
    expect(opts).toContain('chest_middle')
    expect(opts).toContain('serratus')
    expect(opts).toContain('hip_flexors')
  })

  it('isMinorSub: serratus минорная (нет основного упражнения), прочие — нет', () => {
    expect(isMinorSub('serratus')).toBe(true)
    expect(isMinorSub('chest_middle')).toBe(false)
    expect(isMinorSub('hip_flexors')).toBe(false)
    expect(isMinorSub('biceps')).toBe(false)
    expect(isMinorSub('нет-такого')).toBe(false)
    expect(isMinorSub(null)).toBe(false)
  })

  it('подписи: известный → label, неизвестный → сам слаг', () => {
    expect(labelOf('glute_max')).toBe('большая ягодичная')
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
