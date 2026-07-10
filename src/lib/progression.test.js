import { describe, it, expect } from 'vitest'
import {
  resolveProgSettings,
  analyzeLast,
  recommendProgression,
  easyStreak,
  detectPlateau,
} from './progression.js'

// Хелпер: подход
const s = (weight, reps) => ({ weight, reps })
// Хелпер: сессия для recentSessions/easyStreak/detectPlateau
const sess = (sets, performed_at = '2026-01-01') => ({ performed_at, sets })

describe('resolveProgSettings', () => {
  it('дефолты по метрике', () => {
    expect(resolveProgSettings(null, 'e1', 'weight')).toEqual({
      strategy: 'weight', step: 2.5, targetReps: null, repCeiling: 12,
    })
    expect(resolveProgSettings(null, 'e1', 'reps')).toEqual({
      strategy: 'reps', step: 1, targetReps: null, repCeiling: null,
    })
    expect(resolveProgSettings(null, 'e1', 'time')).toEqual({
      strategy: 'reps', step: 5, targetReps: null, repCeiling: null,
    })
    // легаси/мусорная метрика → weight
    expect(resolveProgSettings(null, 'e1', undefined).strategy).toBe('weight')
  })

  it('override перекрывает дефолт', () => {
    const prog = { byExercise: { e1: { strategy: 'reps', step: 5, targetReps: 8, repCeiling: 10 } } }
    expect(resolveProgSettings(prog, 'e1', 'weight')).toEqual({
      strategy: 'reps', step: 5, targetReps: 8, repCeiling: 10,
    })
  })

  it('count-метрика не умеет +вес → приводим к reps', () => {
    const prog = { byExercise: { e1: { strategy: 'weight' } } }
    expect(resolveProgSettings(prog, 'e1', 'reps').strategy).toBe('reps')
    expect(resolveProgSettings(prog, 'e1', 'time').strategy).toBe('reps')
    // а для весового 'weight' остаётся
    expect(resolveProgSettings(prog, 'e1', 'weight').strategy).toBe('weight')
  })

  it('невалидный шаг/потолок откатываются к дефолту', () => {
    const prog = { byExercise: { e1: { step: -1, repCeiling: 0 } } }
    expect(resolveProgSettings(prog, 'e1', 'weight').step).toBe(2.5)
    expect(resolveProgSettings(prog, 'e1', 'weight').repCeiling).toBe(12)
  })
})

describe('analyzeLast', () => {
  it('рабочий вес = макс., план повторов = первый рабочий подход', () => {
    // дроп-сет: разминка 40, рабочие 60
    const a = analyzeLast([s(40, 12), s(60, 10), s(60, 8)], {}, 'weight')
    expect(a.workWeight).toBe(60)
    expect(a.targetReps).toBe(10) // первый рабочий подход
    expect(a.workingCount).toBe(2)
    expect(a.allDone).toBe(false) // второй рабочий 8 < 10
    expect(a.worstShortfall).toBe(2)
  })

  it('override плановых повторов важнее истории', () => {
    const a = analyzeLast([s(80, 8)], { targetReps: 10 }, 'weight')
    expect(a.targetReps).toBe(10)
    expect(a.allDone).toBe(false)
    expect(a.worstShortfall).toBe(2)
  })

  it('count-метрика: вес 0, значение = reps', () => {
    const a = analyzeLast([s(0, 60), s(0, 55)], {}, 'time')
    expect(a.workWeight).toBe(0)
    expect(a.targetReps).toBe(60)
    expect(a.allDone).toBe(false)
  })

  it('нет валидных подходов → null', () => {
    expect(analyzeLast([], {}, 'weight')).toBe(null)
    expect(analyzeLast([s(80, 0)], {}, 'weight')).toBe(null)
    expect(analyzeLast(null, {}, 'weight')).toBe(null)
  })
})

describe('recommendProgression — весовые, стратегия +вес', () => {
  const cfg = { strategy: 'weight', step: 2.5, targetReps: null, repCeiling: 12 }

  it('всё выполнено → +вес', () => {
    const r = recommendProgression({ metric: 'weight', lastSets: [s(80, 10), s(80, 10), s(80, 10)], settings: cfg })
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(82.5, 10), s(82.5, 10), s(82.5, 10)])
    expect(r.changed).toBe(true)
    expect(r.reasonText).toMatch(/\+2\.5 кг/)
  })

  it('лёгкий недобор → тот же вес (same), добиваем план', () => {
    const r = recommendProgression({ metric: 'weight', lastSets: [s(80, 10), s(80, 9), s(80, 8)], settings: cfg })
    expect(r.kind).toBe('same')
    expect(r.sets).toEqual([s(80, 10), s(80, 10), s(80, 10)])
    expect(r.changed).toBe(true)
  })

  it('сильный недобор на ≥2 подходах → снизить вес', () => {
    const r = recommendProgression({ metric: 'weight', lastSets: [s(80, 10), s(80, 6), s(80, 5)], settings: cfg })
    expect(r.kind).toBe('down')
    expect(r.sets).toEqual([s(77.5, 10), s(77.5, 10), s(77.5, 10)])
  })

  it('одиночный подход без override → не снижаем (мягкий дефолт), а идём вверх', () => {
    // цель = сам подход → выполнено → up
    const r = recommendProgression({ metric: 'weight', lastSets: [s(80, 3)], settings: cfg })
    expect(r.kind).toBe('up')
  })

  it('одиночный сильный недобор при override → same (down требует ≥2 подходов)', () => {
    const r = recommendProgression({ metric: 'weight', lastSets: [s(80, 5)], settings: { ...cfg, targetReps: 10 } })
    expect(r.kind).toBe('same')
    expect(r.sets).toEqual([s(80, 10)])
  })

  it('ветка down не уводит вес ≤ 0 (лёгкий снаряд)', () => {
    const r = recommendProgression({ metric: 'weight', lastSets: [s(2.5, 2), s(2.5, 2), s(2.5, 2)], settings: { ...cfg, targetReps: 8 } })
    expect(r.kind).toBe('down')
    // 2.5 − 2.5 = 0 → оставляем 2.5, вес не обнуляем
    expect(r.sets.every((x) => x.weight === 2.5)).toBe(true)
    expect(r.reasonText).toMatch(/тот же вес/)
  })

  it('разминочный подход на меньшем весе сохраняется как есть', () => {
    const r = recommendProgression({ metric: 'weight', lastSets: [s(40, 12), s(60, 10), s(60, 10)], settings: cfg })
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(40, 12), s(62.5, 10), s(62.5, 10)])
  })
})

describe('recommendProgression — весовые, стратегия +повторы', () => {
  const cfg = { strategy: 'reps', step: 2.5, targetReps: null, repCeiling: 12 }

  it('выполнил, ещё не потолок → +1 повтор, вес тот же', () => {
    const r = recommendProgression({
      metric: 'weight',
      lastSets: [s(80, 10), s(80, 10)],
      recentSessions: [sess([s(80, 10), s(80, 10)])],
      settings: cfg,
    })
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(80, 11), s(80, 11)])
    expect(r.reasonText).toMatch(/\+1 повтор/)
  })

  it('дошёл до потолка повторов → +вес, повторы сброшены', () => {
    const r = recommendProgression({
      metric: 'weight',
      lastSets: [s(80, 12), s(80, 12)],
      recentSessions: [sess([s(80, 12), s(80, 12)])],
      settings: cfg,
    })
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(82.5, 8), s(82.5, 8)]) // repFloor(12)=8
    expect(r.reasonText).toMatch(/Потолок/)
  })

  it('нудж: 3 сессии подряд закрыты на одном весе → пора +вес', () => {
    const sets = [s(80, 10), s(80, 10)]
    const r = recommendProgression({
      metric: 'weight',
      lastSets: sets,
      recentSessions: [sess(sets), sess(sets), sess(sets)],
      settings: cfg,
    })
    expect(r.kind).toBe('nudge')
    expect(r.sets).toEqual([s(82.5, 8), s(82.5, 8)])
    expect(r.reasonText).toMatch(/пора \+2\.5 кг/)
  })
})

describe('recommendProgression — count-метрики', () => {
  it('повторы: всё выполнено → +1 повтор', () => {
    const r = recommendProgression({ metric: 'reps', lastSets: [s(0, 12), s(0, 12)], settings: resolveProgSettings(null, 'e', 'reps') })
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(0, 13), s(0, 13)])
  })

  it('время: не добил в пределах допуска → тот же ориентир', () => {
    const r = recommendProgression({ metric: 'time', lastSets: [s(0, 60), s(0, 55)], settings: resolveProgSettings(null, 'e', 'time') })
    expect(r.kind).toBe('same')
    expect(r.sets).toEqual([s(0, 60), s(0, 60)])
  })

  it('время: всё выполнено → +5 секунд', () => {
    const r = recommendProgression({ metric: 'time', lastSets: [s(0, 60), s(0, 60)], settings: resolveProgSettings(null, 'e', 'time') })
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(0, 65), s(0, 65)])
    expect(r.reasonText).toMatch(/\+5 с/)
  })
})

describe('recommendProgression — краевые', () => {
  it('первое выполнение → first, без подстановки', () => {
    expect(recommendProgression({ metric: 'weight', lastSets: null }).kind).toBe('first')
    expect(recommendProgression({ metric: 'weight', lastSets: [] }).kind).toBe('first')
    expect(recommendProgression({ metric: 'weight', lastSets: null }).changed).toBe(false)
  })

  it('стратегия manual/off → копия прошлого, панель не нужна', () => {
    const last = [s(80, 10), s(80, 8)]
    const off = recommendProgression({ metric: 'weight', lastSets: last, settings: { strategy: 'off', step: 2.5 } })
    expect(off.kind).toBe('off')
    expect(off.changed).toBe(false)
    expect(off.sets).toEqual(last)
    const man = recommendProgression({ metric: 'weight', lastSets: last, settings: { strategy: 'manual', step: 2.5 } })
    expect(man.kind).toBe('manual')
  })
})

describe('easyStreak', () => {
  const cfg = { strategy: 'reps', step: 2.5, targetReps: null, repCeiling: 12 }

  it('считает подряд закрытые сессии на одном весе', () => {
    const sets = [s(80, 10), s(80, 10)]
    expect(easyStreak([sess(sets), sess(sets), sess(sets)], cfg, 'weight')).toBe(3)
  })

  it('одиночные подходы считаются выполненными относительно себя (цель = свой первый подход)', () => {
    expect(easyStreak([
      sess([s(80, 10)]),
      sess([s(80, 8)]),
    ], cfg, 'weight')).toBe(2) // обе на весе 80, каждая «закрыта» относительно своего плана
  })

  it('смена рабочего веса обрывает серию', () => {
    expect(easyStreak([
      sess([s(85, 10)]),
      sess([s(80, 10)]),
    ], cfg, 'weight')).toBe(1)
  })

  it('явный недобор относительно первого подхода обрывает серию', () => {
    expect(easyStreak([
      sess([s(80, 10), s(80, 7)]), // цель 10, второй 7 → не allDone
      sess([s(80, 10), s(80, 10)]),
    ], cfg, 'weight')).toBe(0)
  })
})

describe('detectPlateau', () => {
  it('нет роста ведущего показателя в окне → плато', () => {
    const sessions = [sess([s(80, 8)]), sess([s(80, 8)]), sess([s(80, 7)]), sess([s(80, 6)])]
    expect(detectPlateau(sessions, 'weight', { window: 4 })).toBe(true)
  })

  it('новый максимум веса в окне → не плато', () => {
    const sessions = [sess([s(85, 6)]), sess([s(80, 8)]), sess([s(80, 8)]), sess([s(80, 8)])]
    expect(detectPlateau(sessions, 'weight', { window: 4 })).toBe(false)
  })

  it('мало сессий → рано судить (false)', () => {
    expect(detectPlateau([sess([s(80, 8)]), sess([s(80, 8)])], 'weight', { window: 4 })).toBe(false)
  })
})
