import { describe, it, expect } from 'vitest'
import { collectExercises, buildSeries } from './progressSeries.js'

const wk = (day, entries) => ({ performed_at: day, entries })
const ex = (id, name, extra = {}) => ({ id, name, ...extra })

describe('collectExercises', () => {
  it('собирает упражнения из истории, жим лёжа — первым, дальше по имени (ru)', () => {
    const workouts = [
      wk('2026-01-01', [{ exercise: ex('a', 'Присед'), sets: [{ weight: 100, reps: 5 }] }]),
      wk('2026-01-02', [{ exercise: ex('b', 'Жим', { is_bench_lift: true }), sets: [{ weight: 80, reps: 5 }] }]),
      wk('2026-01-03', [{ exercise: ex('c', 'Бицепс'), sets: [{ weight: 20, reps: 10 }] }]),
    ]
    expect(collectExercises(workouts).map((x) => x.name)).toEqual(['Жим', 'Бицепс', 'Присед'])
  })

  it('пропускает упражнения с пустыми подходами', () => {
    const workouts = [
      wk('2026-01-01', [
        { exercise: ex('a', 'Присед'), sets: [] },
        { exercise: ex('b', 'Жим'), sets: [{ weight: 80, reps: 5 }] },
      ]),
    ]
    expect(collectExercises(workouts).map((x) => x.id)).toEqual(['b'])
  })

  it('hasWeight=true, если хоть один подход с весом > 0; иначе false', () => {
    const workouts = [
      wk('2026-01-01', [{ exercise: ex('a', 'Планка'), sets: [{ weight: 0, reps: 60 }] }]),
      wk('2026-01-02', [{ exercise: ex('b', 'Присед'), sets: [{ weight: 100, reps: 5 }] }]),
    ]
    const byId = Object.fromEntries(collectExercises(workouts).map((x) => [x.id, x]))
    expect(byId.a.hasWeight).toBe(false)
    expect(byId.b.hasWeight).toBe(true)
  })

  it('подхватывает явный metric из снимка упражнения', () => {
    const workouts = [wk('2026-01-01', [{ exercise: ex('a', 'Планка', { metric: 'time' }), sets: [{ weight: 0, reps: 60 }] }])]
    expect(collectExercises(workouts)[0].metric).toBe('time')
  })

  it('берёт id из exercise_id, если нет вложенного exercise', () => {
    const workouts = [wk('2026-01-01', [{ exercise_id: 'x1', sets: [{ weight: 50, reps: 5 }] }])]
    const list = collectExercises(workouts)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('x1')
    expect(list[0].name).toBe('Упражнение') // дефолтное имя
  })

  it('пустой/undefined вход → пустой массив', () => {
    expect(collectExercises(undefined)).toEqual([])
    expect(collectExercises([])).toEqual([])
  })
})

describe('buildSeries', () => {
  it('группирует по дням, ведущее значение (weighted) = макс. вес за день', () => {
    const workouts = [
      wk('2026-01-01', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 80, reps: 5 }, { weight: 100, reps: 3 }] }]),
      wk('2026-01-02', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 90, reps: 5 }] }]),
    ]
    const s = buildSeries(workouts, 'a', true)
    expect(s.map((p) => [p.day, p.value])).toEqual([['2026-01-01', 100], ['2026-01-02', 90]])
  })

  it('не-весовое: ведущее значение = макс. повторов, orm=0', () => {
    const workouts = [wk('2026-01-01', [{ exercise: ex('a', 'Подтягивания'), sets: [{ weight: 0, reps: 8 }, { weight: 0, reps: 12 }] }])]
    const s = buildSeries(workouts, 'a', false)
    expect(s[0].value).toBe(12)
    expect(s[0].orm).toBe(0)
  })

  it('бегущий рекорд (isPr): только строгое превышение максимума', () => {
    const workouts = [
      wk('2026-01-01', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 80, reps: 5 }] }]),
      wk('2026-01-02', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 100, reps: 5 }] }]),
      wk('2026-01-03', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 90, reps: 5 }] }]),
      wk('2026-01-04', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 100, reps: 5 }] }]),
    ]
    expect(buildSeries(workouts, 'a', true).map((p) => p.isPr)).toEqual([true, true, false, false])
  })

  it('направление: первая точка up, дальше up/down/flat к прошлой сессии', () => {
    const workouts = [
      wk('2026-01-01', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 90, reps: 5 }] }]),
      wk('2026-01-02', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 100, reps: 5 }] }]),
      wk('2026-01-03', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 100, reps: 5 }] }]),
      wk('2026-01-04', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 80, reps: 5 }] }]),
    ]
    expect(buildSeries(workouts, 'a', true).map((p) => p.dir)).toEqual(['up', 'up', 'flat', 'down'])
  })

  it('сортирует точки по дате по возрастанию независимо от порядка входа', () => {
    const workouts = [
      wk('2026-03-01', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 100, reps: 5 }] }]),
      wk('2026-01-01', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 80, reps: 5 }] }]),
    ]
    expect(buildSeries(workouts, 'a', true).map((p) => p.day)).toEqual(['2026-01-01', '2026-03-01'])
  })

  it('игнорирует другие упражнения и записи без даты/подходов', () => {
    const workouts = [
      wk('2026-01-01', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 80, reps: 5 }] }, { exercise: ex('b', 'Присед'), sets: [{ weight: 120, reps: 5 }] }]),
      wk('', [{ exercise: ex('a', 'Жим'), sets: [{ weight: 999, reps: 1 }] }]), // без даты → пропуск
      wk('2026-01-02', [{ exercise: ex('a', 'Жим'), sets: [] }]),               // пустые подходы → пропуск
    ]
    const s = buildSeries(workouts, 'a', true)
    expect(s.map((p) => [p.day, p.value])).toEqual([['2026-01-01', 80]])
  })

  it('пустой/undefined вход → пустой ряд', () => {
    expect(buildSeries(undefined, 'a', true)).toEqual([])
    expect(buildSeries([], 'a', true)).toEqual([])
  })
})
