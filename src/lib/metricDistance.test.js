// Тип «дистанция» (v6.12.0): бег, ходьба, эллипс, велотренажер.
// Подход {weight: км, reps: секунды}; рекорд — дистанция; темп — считается.
import { describe, expect, it } from 'vitest'
import {
  bestPace, fmtMetricValue, fmtPace, fmtSet, fmtTemplateTarget, hasTimeReps, isCountMetric,
  leadingValue, normMetric, paceSecPerKm, setTonnage,
} from './metric.js'
import { clampSet, repsMax, TIME_MAX } from './setLimits.js'
import { replaceExerciseIn } from './workoutEntries.js'
import { defaultSet, buildRecommendation } from './progressionCard.js'
import { personalRecords, totalTonnage } from './profileStats.js'
import { workoutTonnage } from './insights.js'

const RUN = { id: 'run', name: 'Бег', metric: 'distance' }
const BENCH = { id: 'bench', name: 'Жим', metric: 'weight' }

describe('metric: дистанция', () => {
  it('известная метрика; не «одно число», время — в reps', () => {
    expect(normMetric('distance')).toBe('distance')
    expect(isCountMetric('distance')).toBe(false)
    expect(hasTimeReps('distance')).toBe(true)
    expect(hasTimeReps('weight')).toBe(false)
  })

  it('рекорд — самая длинная дистанция, а не время', () => {
    expect(leadingValue('distance', [{ weight: 5, reps: 1500 }, { weight: 10.5, reps: 3300 }, { weight: 3, reps: 4000 }])).toBe(10.5)
  })

  it('форматы: подход, значение, план шаблона; старый бег без км — только время', () => {
    expect(fmtSet('distance', { weight: 5, reps: 1500 })).toBe('5 км · 25:00')
    expect(fmtSet('distance', { weight: 0, reps: 1200 })).toBe('20:00')
    expect(fmtSet('distance', { weight: 3.25, reps: 0 })).toBe('3.25 км')
    expect(fmtMetricValue('distance', 10.5)).toBe('10.5 км')
    expect(fmtTemplateTarget('distance', { sets: 1, reps: 1800, weight: 5 })).toBe('5 км · 30:00')
    expect(fmtTemplateTarget('distance', { sets: 2, reps: 600, weight: 0 })).toBe('2×10:00')
  })

  it('темп: сек/км, лучший — только от 1 км', () => {
    expect(paceSecPerKm(5, 1500)).toBe(300)
    expect(paceSecPerKm(0, 1500)).toBeNull()
    expect(fmtPace(312)).toBe('5:12 /км')
    expect(fmtPace(null)).toBe('')
    // 0,4 км за 60 с (2:30/км) — рывок, рекорд темпа не дает
    expect(bestPace([{ weight: 0.4, reps: 60 }, { weight: 5, reps: 1550 }, { weight: 2, reps: 560 }])).toBe(280)
    expect(bestPace([{ weight: 0.4, reps: 60 }])).toBeNull()
  })

  it('в тоннаж не идет: км × сек — не килограммы', () => {
    expect(setTonnage('distance', { weight: 5, reps: 1500 })).toBe(0)
    expect(setTonnage('weight', { weight: 80, reps: 5 })).toBe(400)
    const w = { entries: [
      { exercise: RUN, sets: [{ weight: 5, reps: 1500 }] },
      { exercise: BENCH, sets: [{ weight: 80, reps: 5 }] },
    ] }
    expect(workoutTonnage(w)).toBe(400)
    expect(totalTonnage([w])).toBe(400)
  })

  it('границы: время до суток, км сохраняются с 2 знаками', () => {
    expect(repsMax('distance')).toBe(TIME_MAX)
    expect(clampSet('5.555', 1500, 'distance')).toEqual({ weight: 5.56, reps: 1500 })
    expect(clampSet('', 1200, 'distance')).toEqual({ weight: 0, reps: 1200 }) // без км — время сохраняем
  })
})

describe('дистанция в композере и профиле', () => {
  it('замена весового на бег — кг не превращаются в км; бег на эллипс — км остаются', () => {
    const entries = [{ exercise: BENCH, sets: [{ weight: 80, reps: 5 }] }]
    expect(replaceExerciseIn(entries, 0, RUN)[0].sets[0].weight).toBe('')
    const run = [{ exercise: RUN, sets: [{ weight: 5, reps: 1500 }] }]
    expect(replaceExerciseIn(run, 0, { id: 'el', metric: 'distance' })[0].sets[0].weight).toBe(5)
  })

  it('дефолтный подход — 30:00 без км; рекомендаций прогрессии нет', () => {
    expect(defaultSet(RUN)).toMatchObject({ weight: '', reps: 1800 })
    const sessions = [{ metric: 'distance', performed_at: '2026-10-01T10:00:00Z', sets: [{ weight: 5, reps: 1500 }] }]
    const rec = buildRecommendation(RUN, sessions, { enabled: true })
    expect(rec.meta).toBeNull()
    expect(rec.sets[0]).toMatchObject({ weight: 5, reps: 1500 })
  })

  it('личные рекорды: дистанция с лучшим темпом, между весовыми и повторами', () => {
    const ws = [
      { performed_at: '2026-10-01T10:00:00Z', entries: [
        { exercise_id: 'run', exercise: RUN, metric: 'distance', sets: [{ weight: 5, reps: 1500 }, { weight: 10, reps: 3200 }] },
        { exercise_id: 'bench', exercise: BENCH, metric: 'weight', sets: [{ weight: 80, reps: 5 }] },
        { exercise_id: 'pull', exercise: { id: 'pull', name: 'Подтягивания', metric: 'reps' }, metric: 'reps', sets: [{ weight: 0, reps: 12 }] },
      ] },
    ]
    const recs = personalRecords(ws)
    expect(recs.map((r) => r.exId)).toEqual(['bench', 'run', 'pull'])
    expect(recs[1]).toMatchObject({ value: 10, metric: 'distance', pace: 300 })
    expect('pace' in recs[0]).toBe(false)
  })
})
