import { describe, it, expect } from 'vitest'
import {
  bestWeight,
  myBestByExercise,
  minePrs,
  computeBeaten,
  crossedGoal,
  hasSetMeetingGoal,
  goalMetByExercise,
  computeNewPrs,
} from './records.js'

// Хелпер: документ тренировки с одним упражнением.
const wk = (id, performed_at, exercise_id, sets, extra = {}) => ({
  id,
  performed_at,
  entries: [{ exercise_id, exercise: { id: exercise_id, ...extra }, sets }],
})

describe('bestWeight', () => {
  it('макс. вес среди подходов', () => {
    expect(bestWeight([{ weight: 60 }, { weight: 80 }, { weight: 70 }])).toBe(80)
  })
  it('пусто/undefined → 0', () => {
    expect(bestWeight([])).toBe(0)
    expect(bestWeight(undefined)).toBe(0)
  })
})

describe('myBestByExercise', () => {
  it('лучший ведущий показатель по каждому упражнению (метрика-осведомлённо)', () => {
    const workouts = [
      wk('w1', '2026-01-01', 'ex1', [{ weight: 60, reps: 8 }]),
      wk('w2', '2026-01-02', 'ex1', [{ weight: 80, reps: 3 }]),
      // reps-упражнение: ведущая — повторы, вес 0
      wk('w3', '2026-01-03', 'ex2', [{ weight: 0, reps: 12 }], { metric: 'reps' }),
    ]
    const best = myBestByExercise(workouts)
    expect(best.get('ex1').value).toBe(80)
    expect(best.get('ex1').metric).toBe('weight')
    expect(best.get('ex2').value).toBe(12)
    expect(best.get('ex2').metric).toBe('reps')
  })
  it('подходы с нулевым ведущим значением игнорируются', () => {
    const best = myBestByExercise([wk('w1', '2026-01-01', 'ex1', [{ weight: 0, reps: 0 }])])
    expect(best.has('ex1')).toBe(false)
  })
})

describe('minePrs', () => {
  it('первый замер не рекорд, последующее превышение — рекорд', () => {
    const workouts = [
      wk('w1', '2026-01-01', 'ex1', [{ weight: 60, reps: 5 }]),
      wk('w2', '2026-01-02', 'ex1', [{ weight: 80, reps: 3 }]),
    ]
    const prs = minePrs(workouts)
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({ exId: 'ex1', value: 80, prev: 60, type: 'mine' })
  })
  it('равный прежнему — не рекорд', () => {
    const workouts = [
      wk('w1', '2026-01-01', 'ex1', [{ weight: 80, reps: 3 }]),
      wk('w2', '2026-01-02', 'ex1', [{ weight: 80, reps: 5 }]),
    ]
    expect(minePrs(workouts)).toHaveLength(0)
  })
  it('хронология не зависит от порядка во входном массиве', () => {
    const workouts = [
      wk('w2', '2026-01-02', 'ex1', [{ weight: 80, reps: 3 }]),
      wk('w1', '2026-01-01', 'ex1', [{ weight: 60, reps: 5 }]),
    ]
    const prs = minePrs(workouts)
    expect(prs).toHaveLength(1)
    expect(prs[0].prev).toBe(60)
  })
})

describe('computeBeaten', () => {
  it('друг превысил мой рекорд — событие; свои тренировки исключаются', () => {
    const myBest = new Map([['ex1', { value: 80, metric: 'weight', name: 'Жим' }]])
    const feed = [
      { id: 'f1', user_id: 'me', performed_at: '2026-01-05',
        entries: [{ exercise_id: 'ex1', sets: [{ weight: 100, reps: 1 }] }] },
      { id: 'f2', user_id: 'friend', user_name: 'Петя', performed_at: '2026-01-06',
        entries: [{ exercise_id: 'ex1', sets: [{ weight: 90, reps: 2 }] }] },
    ]
    const out = computeBeaten(feed, 'me', myBest)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ who: 'Петя', value: 90, myValue: 80 })
  })
  it('нет своего рекорда по упражнению — нечего бить', () => {
    const feed = [
      { id: 'f1', user_id: 'friend', performed_at: '2026-01-06',
        entries: [{ exercise_id: 'ex9', sets: [{ weight: 90, reps: 2 }] }] },
    ]
    expect(computeBeaten(feed, 'me', new Map())).toHaveLength(0)
  })
  it('планка поднимается — без дублей при повторном превышении', () => {
    const myBest = new Map([['ex1', { value: 80, metric: 'weight', name: 'Жим' }]])
    const feed = [
      { id: 'f1', user_id: 'friend', performed_at: '2026-01-05',
        entries: [{ exercise_id: 'ex1', sets: [{ weight: 90, reps: 1 }] }] },
      { id: 'f2', user_id: 'friend', performed_at: '2026-01-06',
        entries: [{ exercise_id: 'ex1', sets: [{ weight: 85, reps: 1 }] }] },
    ]
    // 85 < новой планки 90 → второго события нет
    expect(computeBeaten(feed, 'me', myBest)).toHaveLength(1)
  })
})

describe('crossedGoal', () => {
  it('пересечение порога именно сейчас', () => {
    expect(crossedGoal(70, 80, 75)).toBe(true)
  })
  it('уже было выше — не событие', () => {
    expect(crossedGoal(80, 90, 75)).toBe(false)
  })
  it('ещё не достигнуто — не событие', () => {
    expect(crossedGoal(60, 70, 75)).toBe(false)
  })
  it('target ≤ 0 / мусор → false', () => {
    expect(crossedGoal(70, 80, 0)).toBe(false)
    expect(crossedGoal(70, 80, undefined)).toBe(false)
  })
})

describe('hasSetMeetingGoal', () => {
  it('только вес (targetReps пуст): любой подход ≥ веса', () => {
    expect(hasSetMeetingGoal([{ weight: 80, reps: 1 }], 80, 0)).toBe(true)
    expect(hasSetMeetingGoal([{ weight: 70, reps: 10 }], 80, 0)).toBe(false)
  })
  it('вес × повторы: нужен ОДИН подход с обоими условиями', () => {
    // вес есть в одном подходе, повторы — в другом → НЕ склеиваются
    const sets = [{ weight: 80, reps: 3 }, { weight: 60, reps: 10 }]
    expect(hasSetMeetingGoal(sets, 80, 5)).toBe(false)
    // один подход удовлетворяет обоим
    expect(hasSetMeetingGoal([{ weight: 80, reps: 6 }], 80, 5)).toBe(true)
  })
  it('targetWeight ≤ 0 → false; пустые подходы → false', () => {
    expect(hasSetMeetingGoal([{ weight: 80, reps: 6 }], 0, 5)).toBe(false)
    expect(hasSetMeetingGoal([], 80, 5)).toBe(false)
    expect(hasSetMeetingGoal(undefined, 80, 5)).toBe(false)
  })
})

describe('goalMetByExercise', () => {
  const workouts = [
    wk('w1', '2026-01-01', 'ex1', [{ weight: 80, reps: 6 }]),
    wk('w2', '2026-01-02', 'ex2', [{ weight: 100, reps: 2 }]),
  ]
  it('находит подход по нужному упражнению', () => {
    expect(goalMetByExercise(workouts, 'ex1', 80, 5)).toBe(true)
    expect(goalMetByExercise(workouts, 'ex1', 80, 10)).toBe(false)
  })
  it('другое упражнение не учитывается', () => {
    expect(goalMetByExercise(workouts, 'ex3', 50, 1)).toBe(false)
  })
})

describe('computeNewPrs', () => {
  it('рекорд только при превышении прежнего (prev > 0)', () => {
    const othersBest = new Map([['ex1', { value: 70, metric: 'weight' }]])
    const saved = [{ exercise_id: 'ex1', exercise: { id: 'ex1' }, sets: [{ weight: 80, reps: 3 }] }]
    const out = computeNewPrs(saved, othersBest)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ value: 80, prev: 70 })
  })
  it('первый замер по упражнению (prev отсутствует) — не рекорд', () => {
    const saved = [{ exercise_id: 'exNew', exercise: { id: 'exNew' }, sets: [{ weight: 50, reps: 3 }] }]
    expect(computeNewPrs(saved, new Map())).toHaveLength(0)
  })
})
