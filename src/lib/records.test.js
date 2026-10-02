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
  it('лучший ведущий показатель по каждому упражнению (метрика-осведомленно)', () => {
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
  const myBest = () => new Map([['ex1', { value: 80, metric: 'weight', name: 'Жим' }]])
  // Элемент ленты с одним упражнением.
  const item = (id, user_id, performed_at, weight, extra = {}) => ({
    id,
    user_id,
    performed_at,
    entries: [{ exercise_id: 'ex1', sets: [{ weight, reps: 1 }] }],
    ...extra,
  })

  it('друг был ниже меня и обошел — событие; свои тренировки исключаются', () => {
    const feed = [
      item('f0', 'friend', '2026-01-04', 70, { user_name: 'Петя' }), // базис: ниже меня
      item('f1', 'me', '2026-01-05', 100), // свое в расчет не идет
      item('f2', 'friend', '2026-01-06', 90, { user_name: 'Петя' }),
    ]
    const out = computeBeaten(feed, 'me', myBest())
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ who: 'Петя', value: 90, myValue: 80, at: '2026-01-06' })
  })

  it('нет своего рекорда по упражнению — нечего бить', () => {
    const feed = [
      { id: 'f1', user_id: 'friend', performed_at: '2026-01-06',
        entries: [{ exercise_id: 'ex9', sets: [{ weight: 90, reps: 2 }] }] },
    ]
    expect(computeBeaten(feed, 'me', new Map())).toHaveLength(0)
  })

  it('первое появление упражнения у друга в окне — базис, не событие', () => {
    // Ровно этот случай ломался: старая тренировка друга выпала из окна ленты,
    // и его привычный вес снова «побивал» меня (v5.14.2).
    const feed = [item('f1', 'friend', '2026-01-06', 90)]
    expect(computeBeaten(feed, 'me', myBest())).toHaveLength(0)
  })

  it('друг и так был выше меня и просто улучшился — не событие', () => {
    const feed = [
      item('f1', 'friend', '2026-01-05', 90),
      item('f2', 'friend', '2026-01-06', 95),
    ]
    expect(computeBeaten(feed, 'me', myBest())).toHaveLength(0)
  })

  it('после перехода дублей нет, сколько бы друг ни рос', () => {
    const feed = [
      item('f1', 'friend', '2026-01-04', 70), // базис
      item('f2', 'friend', '2026-01-05', 90), // переход через 80 → одно событие
      item('f3', 'friend', '2026-01-06', 95),
      item('f4', 'friend', '2026-01-07', 100),
    ]
    const out = computeBeaten(feed, 'me', myBest())
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ value: 90, at: '2026-01-05' })
  })

  it('рост друга ниже моего рекорда событием не считается', () => {
    const feed = [
      item('f1', 'friend', '2026-01-04', 60),
      item('f2', 'friend', '2026-01-05', 75), // выше себя, но ниже моих 80
    ]
    expect(computeBeaten(feed, 'me', myBest())).toHaveLength(0)
  })

  it('друзья считаются независимо друг от друга', () => {
    const feed = [
      item('a1', 'petya', '2026-01-04', 70, { user_name: 'Петя' }),
      item('b1', 'vasya', '2026-01-05', 70, { user_name: 'Вася' }),
      item('a2', 'petya', '2026-01-06', 90, { user_name: 'Петя' }),
      item('b2', 'vasya', '2026-01-07', 85, { user_name: 'Вася' }),
    ]
    const out = computeBeaten(feed, 'me', myBest())
    expect(out.map((n) => n.who)).toEqual(['Петя', 'Вася'])
  })
})

describe('crossedGoal', () => {
  it('пересечение порога именно сейчас', () => {
    expect(crossedGoal(70, 80, 75)).toBe(true)
  })
  it('уже было выше — не событие', () => {
    expect(crossedGoal(80, 90, 75)).toBe(false)
  })
  it('еще не достигнуто — не событие', () => {
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
    expect(out[0]).toMatchObject({ exerciseId: 'ex1', value: 80, prev: 70 })
  })
  it('первый замер по упражнению (prev отсутствует) — не рекорд', () => {
    const saved = [{ exercise_id: 'exNew', exercise: { id: 'exNew' }, sets: [{ weight: 50, reps: 3 }] }]
    expect(computeNewPrs(saved, new Map())).toHaveLength(0)
  })
})

// РЕВЬЮ-КОДА-2026-10-02, п. 17: после смены типа упражнения старые тренировки
// хранят старый снимок exercise, и единицы смешивались в одном максимуме.
describe('смена типа упражнения (старый снимок в тренировках)', () => {
  const oldW = (id, at, sets) => wk(id, at, 'pu', sets, { metric: 'weight', name: 'Отжимания с весом' })
  const newR = (id, at, sets) => wk(id, at, 'pu', sets, { metric: 'reps', name: 'Отжимания' })
  const history = [
    oldW('w1', '2026-01-05T10:00:00Z', [{ weight: 10, reps: 8 }]),
    newR('w2', '2026-01-10T10:00:00Z', [{ weight: 0, reps: 9 }]),
    newR('w3', '2026-01-15T10:00:00Z', [{ weight: 0, reps: 12 }]),
  ]

  it('weight→reps: «12 (было 10)», где 10 — кг, больше не рекорд; рекорд 12 (было 9)', () => {
    const prs = minePrs(history)
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({ metric: 'reps', value: 12, prev: 9, name: 'Отжимания' })
  })

  it('myBestByExercise: метрика и имя — из свежего снимка, кг в максимум не попадают', () => {
    // Старые 10 кг > 9 повторов: раньше «лучшим» был бы вес 10 в метрике weight.
    const best = myBestByExercise(history.slice(0, 2))
    expect(best.get('pu')).toEqual({ value: 9, metric: 'reps', name: 'Отжимания' })
  })

  it('computeNewPrs: прежний максимум в другой единице — не база для рекорда', () => {
    const othersBest = myBestByExercise([history[0]]) // только старые кг
    const saved = history[2].entries
    expect(computeNewPrs(saved, othersBest)).toEqual([])
  })

  it('reps→weight: рекорд по весу не ждет, пока вес превысит старые повторы', () => {
    const list = [
      wk('a', '2026-01-01T10:00:00Z', 'dip', [{ weight: 0, reps: 20 }], { metric: 'reps' }),
      wk('b', '2026-01-05T10:00:00Z', 'dip', [{ weight: 10, reps: 8 }], { metric: 'weight' }),
      wk('c', '2026-01-09T10:00:00Z', 'dip', [{ weight: 12.5, reps: 8 }], { metric: 'weight' }),
    ]
    expect(minePrs(list)).toEqual([
      expect.objectContaining({ exId: 'dip', metric: 'weight', value: 12.5, prev: 10 }),
    ])
    expect(myBestByExercise(list).get('dip')).toMatchObject({ value: 12.5, metric: 'weight' })
    const othersBest = myBestByExercise(list.slice(0, 2))
    expect(computeNewPrs(list[2].entries, othersBest)).toEqual([
      expect.objectContaining({ value: 12.5, prev: 10, metric: 'weight' }),
    ])
  })

  it('легаси-записи без metric и без веса считаются повторами у reps-упражнения', () => {
    const list = [
      wk('a', '2026-01-01T10:00:00Z', 'pull', [{ weight: 0, reps: 8 }]), // до PLAN-metrics
      wk('b', '2026-01-05T10:00:00Z', 'pull', [{ weight: 0, reps: 10 }], { metric: 'reps' }),
    ]
    expect(minePrs(list)).toEqual([expect.objectContaining({ value: 10, prev: 8, metric: 'reps' })])
    expect(myBestByExercise(list).get('pull')).toMatchObject({ value: 10, metric: 'reps' })
  })

  it('computeBeaten: запись друга в старой единице с моим рекордом не сравнивается', () => {
    const myBest = new Map([['pu', { value: 12, metric: 'reps', name: 'Отжимания' }]])
    const feed = [
      { id: 'f1', user_id: 'fr', performed_at: '2026-01-01T10:00:00Z', entries: [{ exercise_id: 'pu', metric: 'reps', sets: [{ weight: 0, reps: 10 }] }] },
      // Старый снимок: 20 кг × 5 — это не «20 повторов».
      { id: 'f2', user_id: 'fr', performed_at: '2026-01-02T10:00:00Z', entries: [{ exercise_id: 'pu', metric: 'weight', sets: [{ weight: 20, reps: 15 }] }] },
    ]
    expect(computeBeaten(feed, 'me', myBest)).toEqual([])
  })
})
