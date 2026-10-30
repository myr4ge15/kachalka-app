import { describe, it, expect } from 'vitest'
import {
  resolveProgSettings,
  analyzeLast,
  recommendProgression,
  easyStreak,
  feelStreak,
  detectPlateau,
  sinceRecord,
} from './progression.js'

// Края автопрогрессии: метрики, гравитрон, границы шага и недобора, ветки стратегии
// «+повторы», счет рекорда. Базовые сценарии — в progression.test.js.

const s = (weight, reps) => ({ weight, reps })
const sess = (sets, feel) => ({ sets, feel })
const rec = (metric, lastSets, settings, recentSessions) =>
  recommendProgression({ metric, lastSets, settings, recentSessions })
const WEIGHT = { strategy: 'weight', step: 2.5, targetReps: null, repCeiling: 12 }
const REPS = { strategy: 'reps', step: 2.5, targetReps: null, repCeiling: 12 }
const cfg = (metric) => resolveProgSettings(null, 'e', metric)

describe('resolveProgSettings: края', () => {
  it('целевые повторы округляются, мусор отбрасывается', () => {
    const of = (ov) => resolveProgSettings({ byExercise: { e: ov } }, 'e', 'weight')
    expect(of({ targetReps: 8.6 }).targetReps).toBe(9)
    expect(of({ targetReps: 0 }).targetReps).toBeNull()
    expect(of({ targetReps: 'x' }).targetReps).toBeNull()
    expect(of({ repCeiling: 9.4 }).repCeiling).toBe(9)
    expect(of({ strategy: 'мусор' }).strategy).toBe('weight')
  })

  it('стратегии manual и off сохраняются у любой метрики', () => {
    const prog = { byExercise: { e: { strategy: 'manual' } } }
    expect(resolveProgSettings(prog, 'e', 'reps').strategy).toBe('manual')
    expect(resolveProgSettings({ byExercise: { e: { strategy: 'off' } } }, 'e', 'time').strategy).toBe('off')
  })

  it('чужое упражнение настройки не наследует', () => {
    const prog = { byExercise: { other: { step: 10 } } }
    expect(resolveProgSettings(prog, 'e', 'weight').step).toBe(2.5)
    expect(resolveProgSettings({}, 'e', 'weight').step).toBe(2.5)
  })

  it('время: дробный шаг округляется, шаг секундами сохраняется', () => {
    expect(resolveProgSettings({ byExercise: { e: { step: 7.5 } } }, 'e', 'time').step).toBe(8)
    expect(resolveProgSettings({ byExercise: { e: { step: 10 } } }, 'e', 'time').step).toBe(10)
  })

  it('дистанция: без своих дефолтов, стратегия «+вес» к ней не применяется', () => {
    expect(resolveProgSettings(null, 'e', 'distance').strategy).toBe('reps')
  })
})

describe('analyzeLast: границы недобора', () => {
  it('вес: сильный недобор — от 3 повторов', () => {
    expect(analyzeLast([s(80, 10), s(80, 8), s(80, 8)], {}, 'weight').bigShortCount).toBe(0)
    expect(analyzeLast([s(80, 10), s(80, 7), s(80, 7)], {}, 'weight').bigShortCount).toBe(2)
  })

  it('повторы: тот же порог 3', () => {
    expect(analyzeLast([s(0, 12), s(0, 10)], {}, 'reps').bigShortCount).toBe(0)
    expect(analyzeLast([s(0, 12), s(0, 9)], {}, 'reps').bigShortCount).toBe(1)
  })

  it('время: сильный недобор — от 10 секунд', () => {
    expect(analyzeLast([s(0, 60), s(0, 51)], {}, 'time').bigShortCount).toBe(0)
    expect(analyzeLast([s(0, 60), s(0, 50)], {}, 'time').bigShortCount).toBe(1)
  })

  it('count-метрика: вес снаряда и доп. вес рабочие подходы не отсекают', () => {
    const a = analyzeLast([s(20, 60), s(0, 60)], {}, 'time')
    expect(a).toMatchObject({ workWeight: 0, workingCount: 2, allDone: true })
  })

  it('подход с нулевыми повторами в рабочие не идет', () => {
    const a = analyzeLast([s(100, 0), s(80, 5), null], {}, 'weight')
    expect(a).toMatchObject({ workWeight: 80, targetReps: 5, workingCount: 1 })
  })

  it('числа-строки из формы читаются как числа', () => {
    expect(analyzeLast([s('62.5', '8')], {}, 'weight')).toMatchObject({ workWeight: 62.5, targetReps: 8 })
  })

  it('без настроек и метрики — вес и план из первого подхода', () => {
    expect(analyzeLast([s(50, 8)])).toMatchObject({ metric: 'weight', targetReps: 8, allDone: true })
  })
})

describe('recommendProgression: вес, стратегия «+вес», границы шага', () => {
  it('нестандартный шаг печатается без хвостовых нулей', () => {
    const r = rec('weight', [s(80, 10)], { ...WEIGHT, step: 1.25 })
    expect(r.sets).toEqual([s(81.25, 10)])
    expect(r.reasonText).toBe('Все выполнено → +1.25 кг')
    expect(rec('weight', [s(80, 10)], { ...WEIGHT, step: 5 }).reasonText).toBe('Все выполнено → +5 кг')
  })

  it('вес не копит хвост плавающей запятой', () => {
    expect(rec('weight', [s(0.1, 10)], { ...WEIGHT, step: 0.2 }).sets).toEqual([s(0.3, 10)])
  })

  it('недобор ровно на границе сильного: 2 → тот же вес, 3 → снижение', () => {
    expect(rec('weight', [s(80, 10), s(80, 8), s(80, 8)], WEIGHT).kind).toBe('same')
    expect(rec('weight', [s(80, 10), s(80, 7), s(80, 7)], WEIGHT).kind).toBe('down')
  })

  it('«тот же вес» называет план: подходы × повторы', () => {
    expect(rec('weight', [s(80, 10), s(80, 9), s(80, 9)], WEIGHT).reasonText)
      .toBe('Повторения не добраны → тот же вес, цель 3×10')
  })

  it('снижение до ровно нуля не проходит, чуть выше нуля — проходит', () => {
    const low = rec('weight', [s(5, 2), s(5, 2)], { ...WEIGHT, targetReps: 8 })
    expect(low.sets).toEqual([s(2.5, 8), s(2.5, 8)])
    expect(low.reasonText).toBe('Тяжело далось → −2.5 кг, закрепимся')
  })

  it('«тяжело» подряд при легком весе: вес держим, в причине серия', () => {
    const sets = [s(2.5, 10), s(2.5, 9)]
    const r = rec('weight', sets, WEIGHT, [sess(sets, 'hard'), sess(sets, 'hard')])
    expect(r.sets.every((x) => x.weight === 2.5)).toBe(true)
    expect(r.reasonText).toBe('2 раза подряд «тяжело» → тот же вес, закрепимся')
  })

  it('длинная серия «тяжело» склоняется', () => {
    const sets = [s(80, 10), s(80, 9)]
    const r = rec('weight', sets, WEIGHT, Array.from({ length: 5 }, () => sess(sets, 'hard')))
    expect(r.reasonText).toBe('5 раз подряд «тяжело» → −2.5 кг, закрепимся')
  })

  it('план добит и «тяжело» два раза — важнее добитый план: держим, не снижаем', () => {
    const sets = [s(80, 10), s(80, 10)]
    const r = rec('weight', sets, WEIGHT, [sess(sets, 'hard'), sess(sets, 'hard')])
    expect(r.kind).toBe('same')
    expect(r.changed).toBe(false)
  })

  it('нулевой шаг в настройках — дефолт метрики', () => {
    expect(rec('weight', [s(80, 10)], { ...WEIGHT, step: 0 }).sets).toEqual([s(82.5, 10)])
  })

  it('упражнение без настроек — дефолты метрики', () => {
    expect(recommendProgression({ metric: 'weight', lastSets: [s(80, 10)] }).sets).toEqual([s(82.5, 10)])
    expect(recommendProgression({ lastSets: [s(80, 10)] }).kind).toBe('up')
  })

  it('без аргументов и с подходами без повторов — первая тренировка', () => {
    expect(recommendProgression().kind).toBe('first')
    expect(recommendProgression({ metric: 'weight', lastSets: [s(80, 0)], settings: WEIGHT }))
      .toEqual({ kind: 'first', sets: null, reasonText: '', changed: false })
  })

  it('подходы на весе ниже рабочего при снижении не трогаем', () => {
    const r = rec('weight', [s(40, 12), s(60, 10), s(60, 5), s(60, 5)], WEIGHT)
    expect(r.kind).toBe('down')
    expect(r.sets).toEqual([s(40, 12), s(57.5, 10), s(57.5, 10), s(57.5, 10)])
  })
})

describe('recommendProgression: вес, стратегия «+повторы»', () => {
  it('легкий недобор → тот же вес, цель названа', () => {
    const r = rec('weight', [s(80, 10), s(80, 9)], REPS)
    expect(r.kind).toBe('same')
    expect(r.sets).toEqual([s(80, 10), s(80, 10)])
    expect(r.reasonText).toBe('Не добрано → тот же вес, цель 2×10')
  })

  it('сильный недобор → меньше повторов, вес тот же', () => {
    const r = rec('weight', [s(80, 10), s(80, 6), s(80, 6)], REPS)
    expect(r.kind).toBe('down')
    expect(r.sets).toEqual([s(80, 9), s(80, 9), s(80, 9)])
    expect(r.reasonText).toBe('Тяжело далось → меньше повторений, закрепимся')
  })

  it('«тяжело» подряд при легком недоборе → снижаем с причиной-серией', () => {
    const sets = [s(80, 10), s(80, 9)]
    const r = rec('weight', sets, REPS, [sess(sets, 'hard'), sess(sets, 'hard')])
    expect(r.kind).toBe('down')
    expect(r.reasonText).toBe('2 раза подряд «тяжело» → меньше повторений, закрепимся')
  })

  it('два закрытых раза подряд — еще не нудж', () => {
    const sets = [s(80, 10), s(80, 10)]
    const r = rec('weight', sets, REPS, [sess(sets), sess(sets)])
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(80, 11), s(80, 11)])
  })

  it('без истории серия считается по одной прошлой сессии', () => {
    const r = rec('weight', [s(80, 10)], REPS)
    expect(r.reasonText).toBe('Все выполнено → +1 повторение')
  })

  it('длинная серия закрытых склоняется', () => {
    const sets = [s(80, 10)]
    const r = rec('weight', sets, REPS, Array.from({ length: 5 }, () => sess(sets)))
    expect(r.reasonText).toBe('5 тренировок подряд закрываешь → пора +2.5 кг')
  })

  it('потолок: ниже потолка +1, ровно на нем и выше — вес', () => {
    const c = { ...REPS, repCeiling: 10 }
    expect(rec('weight', [s(80, 9)], c).sets).toEqual([s(80, 10)])
    expect(rec('weight', [s(80, 10)], c).sets).toEqual([s(82.5, 6)])
    expect(rec('weight', [s(80, 15)], c).reasonText).toBe('Потолок 10 повт. → +2.5 кг')
  })

  it('без потолка в настройках — 12', () => {
    const r = rec('weight', [s(80, 12)], { ...REPS, repCeiling: null })
    expect(r.sets).toEqual([s(82.5, 8)])
    expect(r.reasonText).toBe('Потолок 12 повт. → +2.5 кг')
  })

  it('низкий потолок: база повторов после прибавки не ниже 1', () => {
    expect(rec('weight', [s(80, 3)], { ...REPS, repCeiling: 3 }).sets).toEqual([s(82.5, 1)])
  })

  it('свой потолок двигает базу и в нудже', () => {
    const sets = [s(80, 8)]
    const r = rec('weight', sets, { ...REPS, repCeiling: 10 }, [sess(sets), sess(sets), sess(sets)])
    expect(r.sets).toEqual([s(82.5, 6)])
  })

  it('«легко» меньше трех раз, но закрытых три: нудж с формулировкой по числам', () => {
    const sets = [s(80, 10)]
    const r = rec('weight', sets, REPS, [sess(sets, 'easy'), sess(sets, 'easy'), sess(sets)])
    expect(r.kind).toBe('nudge')
    expect(r.reasonText).toBe('3 тренировки подряд закрываешь → пора +2.5 кг')
  })

  it('нудж рвется сменой веса в истории', () => {
    const r = rec('weight', [s(80, 10)], REPS, [sess([s(80, 10)]), sess([s(77.5, 10)]), sess([s(80, 10)])])
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(80, 11)])
  })
})

describe('recommendProgression: свой вес, гравитрон, время', () => {
  it('гравитрон: помощь переносится со знаком, растут повторы', () => {
    const r = rec('reps', [s(-20, 8), s(-20, 8)], cfg('reps'))
    expect(r.kind).toBe('up')
    expect(r.sets).toEqual([s(-20, 9), s(-20, 9)])
    expect(r.reasonText).toBe('Все выполнено → +1 повт.')
  })

  it('гравитрон: снижение не трогает помощь', () => {
    const r = rec('reps', [s(-30, 10), s(-30, 6), s(-30, 6)], cfg('reps'))
    expect(r.kind).toBe('down')
    expect(r.sets).toEqual([s(-30, 9), s(-30, 9), s(-30, 9)])
    expect(r.reasonText).toBe('Тяжело далось → снизим, закрепимся')
  })

  it('гравитрон: «тяжело» при добитом плане — как есть', () => {
    const sets = [s(-20, 8), s(-30, 8)]
    const r = rec('reps', sets, cfg('reps'), [sess(sets, 'hard')])
    expect(r.kind).toBe('same')
    expect(r.sets).toEqual(sets)
    expect(r.changed).toBe(false)
  })

  it('разный доп. вес у подходов сохраняется у каждого', () => {
    expect(rec('reps', [s(10, 8), s(20, 8)], cfg('reps')).sets).toEqual([s(10, 9), s(20, 9)])
  })

  it('время: вес снаряда переносится, растут секунды', () => {
    const r = rec('time', [s(20, 60), s(20, 60)], cfg('time'))
    expect(r.sets).toEqual([s(20, 65), s(20, 65)])
  })

  it('время: граница сильного недобора 10 секунд', () => {
    expect(rec('time', [s(0, 60), s(0, 51), s(0, 51)], cfg('time')).kind).toBe('same')
    const r = rec('time', [s(0, 60), s(0, 50), s(0, 50)], cfg('time'))
    expect(r.kind).toBe('down')
    expect(r.sets).toEqual([s(0, 55), s(0, 55), s(0, 55)])
  })

  it('время: недобор в пределах допуска называет цель', () => {
    expect(rec('time', [s(0, 60), s(0, 55)], cfg('time')).reasonText).toBe('Не добрано → тот же ориентир, цель 60')
  })

  it('count: «тяжело» подряд снижает и называет серию', () => {
    const sets = [s(0, 12), s(0, 11)]
    const r = rec('reps', sets, cfg('reps'), [sess(sets, 'hard'), sess(sets, 'hard')])
    expect(r.kind).toBe('down')
    expect(r.sets).toEqual([s(0, 11), s(0, 11)])
    expect(r.reasonText).toBe('2 раза подряд «тяжело» → снизим, закрепимся')
  })

  it('count: снижение не уходит ниже одного повтора', () => {
    const sets = [s(0, 3), s(0, 2)]
    const r = rec('reps', sets, { ...cfg('reps'), step: 5 }, [sess(sets, 'hard'), sess(sets, 'hard')])
    expect(r.sets).toEqual([s(0, 1), s(0, 1)])
  })

  it('count: план из настроек важнее первого подхода — «вверх» от плана', () => {
    const r = rec('reps', [s(0, 12), s(0, 15)], { ...cfg('reps'), targetReps: 12 })
    expect(r.sets).toEqual([s(0, 13), s(0, 16)])
  })

  it('count: нулевой шаг — дефолт метрики', () => {
    expect(rec('time', [s(0, 60)], { strategy: 'reps', step: 0 }).sets).toEqual([s(0, 65)])
    expect(rec('reps', [s(0, 10)], { strategy: 'reps', step: 0 }).sets).toEqual([s(0, 11)])
  })

  it('count: стратегия «+вес», пришедшая мимо настроек, ведет себя как повторы', () => {
    const r = rec('reps', [s(10, 8)], { strategy: 'weight', step: 1 })
    expect(r.sets).toEqual([s(10, 9)])
  })

  it('manual у count-метрики: копия с весом как есть', () => {
    const r = rec('reps', [s(-20, 8)], { strategy: 'manual', step: 1 })
    expect(r).toEqual({ kind: 'manual', sets: [s(-20, 8)], reasonText: '', changed: false })
  })
})

describe('easyStreak: формы входа и метрики', () => {
  it('пустой вход — 0', () => {
    expect(easyStreak(null, {}, 'weight')).toBe(0)
    expect(easyStreak(undefined)).toBe(0)
    expect(easyStreak([], {}, 'reps')).toBe(0)
  })

  it('сессия массивом подходов, пустая сессия рвет серию', () => {
    expect(easyStreak([[s(80, 10)], [s(80, 10)]], {}, 'weight')).toBe(2)
    expect(easyStreak([[s(80, 10)], null, [s(80, 10)]], {}, 'weight')).toBe(1)
    expect(easyStreak([{ sets: [] }], {}, 'weight')).toBe(0)
  })

  it('count-метрика: вес не сверяем — смена доп. веса серию не рвет', () => {
    expect(easyStreak([[s(10, 8)], [s(-20, 8)], [s(0, 8)]], {}, 'reps')).toBe(3)
  })

  it('план из настроек: недобор до него рвет серию', () => {
    expect(easyStreak([[s(0, 12)], [s(0, 9)]], { targetReps: 10 }, 'reps')).toBe(1)
  })
})

describe('feelStreak: края', () => {
  it('пустая сессия и мусорная оценка рвут серию', () => {
    expect(feelStreak([sess([], 'easy'), null, sess([], 'easy')], 'easy')).toBe(1)
    expect(feelStreak([sess([], 'мусор')], 'easy')).toBe(0)
  })
})

describe('detectPlateau: метрики и формы входа', () => {
  const list = (...reps) => reps.map((r) => sess([s(0, r)]))

  it('пустой вход — рано судить', () => {
    expect(detectPlateau(null)).toBe(false)
    expect(detectPlateau(undefined, 'time')).toBe(false)
  })

  it('сессии массивами подходов', () => {
    expect(detectPlateau([[s(80, 8)], [s(80, 8)]], 'weight', { window: 2 })).toBe(true)
  })

  it('окно по умолчанию — 4, старше окна не смотрим', () => {
    const fresh4 = [sess([s(80, 8)]), sess([s(80, 8)]), sess([s(80, 8)]), sess([s(80, 8)]), sess([s(20, 8)])]
    expect(detectPlateau(fresh4)).toBe(true)
  })

  it('пустая сессия в окне считается нулем', () => {
    expect(detectPlateau([{ sets: [] }, null, sess([s(80, 8)])], 'weight', { window: 3 })).toBe(true)
  })

  it('время: рост секунд — не плато, ровно — плато', () => {
    expect(detectPlateau(list(70, 60, 60, 60), 'time')).toBe(false)
    expect(detectPlateau(list(60, 60, 60, 60), 'time')).toBe(true)
  })

  it('время: вес снаряда не считается ростом', () => {
    const sessions = [sess([s(20, 60)]), sess([s(10, 60)]), sess([s(0, 60)])]
    expect(detectPlateau(sessions, 'time', { window: 3 })).toBe(true)
  })

  it('дистанция: рост км — не плато; те же км быстрее ростом не считаются', () => {
    const km = (v, sec) => sess([s(v, sec)])
    expect(detectPlateau([km(6, 1800), km(5, 1500), km(5, 1500)], 'distance', { window: 3 })).toBe(false)
    expect(detectPlateau([km(5, 1400), km(5, 1500), km(5, 1600)], 'distance', { window: 3 })).toBe(true)
    expect(detectPlateau([km(5, 1800), km(5, 1500), km(5, 1400)], 'distance', { window: 3 })).toBe(true)
  })

  it('гравитрон: меньше помощи на тех же повторах — рост; больше — плато', () => {
    const grav = (w, r = 10) => sess([s(w, r)])
    expect(detectPlateau([grav(-20), grav(-30), grav(-40)], 'reps', { window: 3 })).toBe(false)
    expect(detectPlateau([grav(-40), grav(-30), grav(-20)], 'reps', { window: 3 })).toBe(true)
  })

  it('свой вес: более свежая сессия с большими повторами — рост, что бы ни было с весом', () => {
    expect(detectPlateau([sess([s(-40, 12)]), sess([s(0, 10)])], 'reps', { window: 2 })).toBe(false)
  })

  it('свой вес: при равных повторах в сравнение идет лучший подход сессии', () => {
    const best = sess([s(-40, 10), s(-20, 10), s(-30, 8)])
    expect(detectPlateau([best, sess([s(-30, 10)])], 'reps', { window: 2 })).toBe(false)
  })

  it('весовые: второй показатель — повторы на лучшем весе, а не лучшие вообще', () => {
    const sessions = [sess([s(80, 8), s(40, 20)]), sess([s(80, 8)])]
    expect(detectPlateau(sessions, 'weight', { window: 2 })).toBe(true)
  })
})

describe('sinceRecord', () => {
  it('пустой вход — рекорда нет', () => {
    expect(sinceRecord([])).toEqual({ since: 0, record: -1 })
    expect(sinceRecord(null, 'reps')).toEqual({ since: 0, record: -1 })
  })

  it('одна тренировка — она и рекорд', () => {
    expect(sinceRecord([sess([s(80, 5)])])).toEqual({ since: 0, record: 0 })
  })

  it('свежая тренировка побила все — рекорд она', () => {
    expect(sinceRecord([sess([s(90, 5)]), sess([s(80, 5)]), sess([s(70, 5)])])).toEqual({ since: 0, record: 0 })
  })

  it('рекорд в середине: since — сколько сессий новее', () => {
    expect(sinceRecord([sess([s(70, 5)]), sess([s(75, 5)]), sess([s(90, 5)]), sess([s(80, 5)])])).toEqual({ since: 2, record: 2 })
  })

  it('повтор рекорда — не рекорд: остается более ранний', () => {
    expect(sinceRecord([sess([s(80, 5)]), sess([s(80, 5)])])).toEqual({ since: 1, record: 1 })
  })

  it('больше повторов на том же весе — новый рекорд', () => {
    expect(sinceRecord([sess([s(80, 6)]), sess([s(80, 5)])]).record).toBe(0)
  })

  it('сессии массивами и пустые сессии', () => {
    expect(sinceRecord([[s(80, 5)], [], [s(70, 5)]])).toEqual({ since: 0, record: 0 })
    expect(sinceRecord([null, [s(70, 5)]])).toEqual({ since: 1, record: 1 })
  })

  it('все сессии пустые: рекорд — самая старая, сравнивать нечего', () => {
    expect(sinceRecord([[], []], 'reps')).toEqual({ since: 1, record: 1 })
  })

  it('время: рекорд по секундам', () => {
    const list = [sess([s(0, 80)]), sess([s(0, 90)]), sess([s(0, 60)])]
    expect(sinceRecord(list, 'time')).toEqual({ since: 1, record: 1 })
  })

  it('дистанция: рекорд по км, время не влияет', () => {
    const list = [sess([s(5, 1400)]), sess([s(5, 1500)]), sess([s(4, 1000)])]
    expect(sinceRecord(list, 'distance')).toEqual({ since: 1, record: 1 })
  })

  it('гравитрон: рекорд — меньше помощи на тех же повторах', () => {
    const list = [sess([s(-40, 10)]), sess([s(-20, 10)]), sess([s(-30, 10)])]
    expect(sinceRecord(list, 'reps')).toEqual({ since: 1, record: 1 })
  })
})
