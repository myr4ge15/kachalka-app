import { describe, it, expect } from 'vitest'
import { buildHomeSummary, buildTrainingRhythm, fmtDaysAgo, fmtDays } from './homeSummary.js'

function wk({ id, at, entries }) {
  return {
    id,
    user_id: 'me',
    performed_at: at,
    created_at: at,
    entries: (entries ?? []).map((e) => ({
      exercise_id: e.exId,
      exercise: {
        id: e.exId,
        name: e.name ?? e.exId,
        muscle_group: e.group ?? null,
        is_bench_lift: Boolean(e.bench),
        metric: e.metric ?? 'weight',
      },
      sets: e.sets ?? [],
    })),
  }
}
const S = (weight, reps) => ({ weight, reps })
const NOW = new Date('2026-07-10T12:00:00')
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('buildHomeSummary', () => {
  it('пустая история → hasData:false и нули', () => {
    const s = buildHomeSummary({ workouts: [], goals: [], now: NOW })
    expect(s.hasData).toBe(false)
    expect(s.streak).toBe(0)
    expect(s.lastWorkout).toBeNull()
    expect(s.latestPr).toBeNull()
  })

  it('последняя тренировка: дни назад и теги подмышц (слайс 3a)', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(2), entries: [{ exId: 'bp', name: 'Жим', group: 'грудь', bench: true, sets: [S(80, 5)] }] }),
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.hasData).toBe(true)
    expect(s.lastWorkout.daysAgo).toBe(2)
    // теги теперь по подмышцам; без submuscle у записи — фолбэк на дефолт группы (грудь → chest_middle)
    expect(s.lastWorkout.tags).toContain('chest_middle')
  })

  it('тоннаж месяца и дельта против прошлого', () => {
    const list = [
      wk({ id: 'r', at: daysAgo(5), entries: [{ exId: 'x', sets: [S(100, 10)] }] }),  // 1000
      wk({ id: 'o', at: daysAgo(40), entries: [{ exId: 'x', sets: [S(80, 10)] }] }),   // 800
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.tonnage.month).toBe(1000)
    expect(s.tonnage.prevMonth).toBe(800)
    expect(s.tonnage.pct).toBe(25)
    // тренировки — в том же окне 30 дней, что и тоннаж (не «календарный месяц»)
    expect(s.workouts30).toBe(1)
  })

  it('последний рекорд — самый свежий момент превышения', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(95, 3)] }] }),
      wk({ id: 'mid', at: daysAgo(7), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(90, 3)] }] }),
      wk({ id: 'old', at: daysAgo(14), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(80, 3)] }] }),
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.latestPr).toBeTruthy()
    expect(s.latestPr.value).toBe(95)
    expect(s.latestPr.at).toBe(list[0].performed_at)
  })

  it('забытая группа — самая просроченная', () => {
    const list = [
      wk({ id: 'legs', at: daysAgo(18), entries: [{ exId: 'sq', group: 'ноги', sets: [S(100, 5)] }] }),
      wk({ id: 'chest', at: daysAgo(1), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
    ]
    const s = buildHomeSummary({ workouts: list, goals: [], now: NOW })
    expect(s.nextFocus.group).toBe('ноги')
    expect(s.nextFocus.daysAgo).toBe(18)
  })

  it('ближайшая цель — с наибольшим прогрессом', () => {
    const list = [wk({ id: 'a', at: daysAgo(1), entries: [{ exId: 'bp', name: 'Жим', bench: true, sets: [S(90, 5)] }] })]
    const goals = [
      { exerciseId: 'bp', exerciseName: 'Жим', metric: 'weight', targetWeight: 100, achievedAt: null },
      { exerciseId: 'sq', exerciseName: 'Присед', metric: 'weight', targetWeight: 200, achievedAt: null },
    ]
    const s = buildHomeSummary({ workouts: list, goals, now: NOW })
    expect(s.nearestGoal.name).toBe('Жим')
    expect(s.nearestGoal.pct).toBe(90)
    expect(s.nearestGoal.left).toBe(10)
  })

  it('достигнутые/удаленные цели не считаются', () => {
    const list = [wk({ id: 'a', at: daysAgo(1), entries: [{ exId: 'bp', name: 'Жим', sets: [S(90, 5)] }] })]
    const goals = [{ exerciseId: 'bp', exerciseName: 'Жим', metric: 'weight', targetWeight: 100, achievedAt: '2026-01-01' }]
    const s = buildHomeSummary({ workouts: list, goals, now: NOW })
    expect(s.nearestGoal).toBeNull()
  })
})

describe('fmtDaysAgo', () => {
  it('форматы дней', () => {
    expect(fmtDaysAgo(0)).toBe('сегодня')
    expect(fmtDaysAgo(1)).toBe('вчера')
    expect(fmtDaysAgo(2)).toBe('2 дня назад')
    expect(fmtDaysAgo(5)).toBe('5 дней назад')
    expect(fmtDaysAgo(21)).toBe('21 день назад')
  })
})

describe('fmtDays', () => {
  it('длительность без «назад», склонение по числу', () => {
    expect(fmtDays(1)).toBe('1 день')
    expect(fmtDays(2)).toBe('2 дня')
    expect(fmtDays(18)).toBe('18 дней')
    expect(fmtDays(21)).toBe('21 день')
  })
})

describe('buildTrainingRhythm', () => {
  it('строит календарные недели и объединяет тренировки одного дня', () => {
    const sameDay = daysAgo(2)
    const rhythm = buildTrainingRhythm([
      wk({ id: 'a', at: sameDay, entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
      wk({ id: 'b', at: sameDay, entries: [{ exId: 'tr', group: 'трицепс', sets: [S(30, 8)] }] }),
    ], { now: NOW, weeks: 2 })

    expect(rhythm).toHaveLength(2)
    expect(rhythm.at(-1)).toMatchObject({
      start: '2026-07-06',
      end: '2026-07-12',
      current: true,
    })
    expect(rhythm.at(-1).days).toHaveLength(7)
    expect(rhythm.at(-1).days.find((d) => d.today)?.day).toBe('2026-07-10')
    expect(rhythm.at(-1).days.filter((d) => d.future)).toHaveLength(2)
    const trained = rhythm.flatMap((w) => w.days).find((d) => d.count > 0)
    expect(trained.count).toBe(2)
    expect(trained.tags.length).toBeGreaterThan(0)
  })

  it('недели до первой тренировки помечены beforeFirst — это не пропуски', () => {
    const rhythm = buildTrainingRhythm([
      wk({ id: 'a', at: daysAgo(9), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
    ], { now: NOW, weeks: 4 })
    expect(rhythm.map((w) => w.beforeFirst)).toEqual([true, true, false, false])
  })

  it('пустая история все равно дает восемь устойчивых недель', () => {
    const rhythm = buildTrainingRhythm([], { now: NOW })
    expect(rhythm).toHaveLength(8)
    expect(rhythm.every((w) => w.count === 0 && w.beforeFirst)).toBe(true)
  })
})

// РЕВЬЮ-КОДА-2026-10-02, п. 17: снимок упражнения в старых тренировках не
// обновляется после смены типа — единицы не должны смешиваться в «последнем рекорде».
describe('latestPr после смены типа упражнения', () => {
  it('weight→reps: первые повторы после кг — не рекорд «12 (было 10)»', () => {
    const list = [
      wk({ id: 'n2', at: daysAgo(1), entries: [{ exId: 'pu', name: 'Отжимания', metric: 'reps', sets: [S(0, 11)] }] }),
      wk({ id: 'n1', at: daysAgo(5), entries: [{ exId: 'pu', name: 'Отжимания', metric: 'reps', sets: [S(0, 12)] }] }),
      wk({ id: 'o', at: daysAgo(10), entries: [{ exId: 'pu', name: 'Отжимания с весом', sets: [S(10, 8)] }] }),
    ]
    expect(buildHomeSummary({ workouts: list, goals: [], now: NOW }).latestPr).toBeNull()
  })

  it('reps→weight: рекорд по весу виден сразу, имя — из свежего снимка', () => {
    const list = [
      wk({ id: 'c', at: daysAgo(1), entries: [{ exId: 'dip', name: 'Брусья с весом', sets: [S(12.5, 8)] }] }),
      wk({ id: 'b', at: daysAgo(5), entries: [{ exId: 'dip', name: 'Брусья с весом', sets: [S(10, 8)] }] }),
      wk({ id: 'a', at: daysAgo(10), entries: [{ exId: 'dip', name: 'Брусья', metric: 'reps', sets: [S(0, 20)] }] }),
    ]
    expect(buildHomeSummary({ workouts: list, goals: [], now: NOW }).latestPr).toMatchObject({
      name: 'Брусья с весом', metric: 'weight', value: 12.5,
    })
  })
})
