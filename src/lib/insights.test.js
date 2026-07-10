import { describe, it, expect } from 'vitest'
import {
  buildInsights,
  workoutTonnage,
  tonnageInWindow,
  dayIndex,
} from './insights.js'

// Хелпер: собрать документ тренировки. entries: [{exId,name,group,metric,bench,sets}]
function wk({ id, at, created, entries }) {
  return {
    id,
    user_id: 'me',
    performed_at: at,
    created_at: created ?? at,
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
// N дней назад от фиксированного "сейчас".
const NOW = new Date('2026-07-10T12:00:00')
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('вспомогательные', () => {
  it('workoutTonnage считает только подходы с весом', () => {
    const w = wk({ id: 'a', at: daysAgo(0), entries: [
      { exId: 'x', sets: [S(100, 5), S(0, 30)] }, // 500 + 0 (свой вес)
    ] })
    expect(workoutTonnage(w)).toBe(500)
  })

  it('tonnageInWindow разделяет соседние окна', () => {
    const list = [
      wk({ id: 'r', at: daysAgo(5), entries: [{ exId: 'x', sets: [S(100, 10)] }] }),  // 1000, окно [0,30)
      wk({ id: 'o', at: daysAgo(40), entries: [{ exId: 'x', sets: [S(50, 10)] }] }),   // 500, окно [30,60)
    ]
    expect(tonnageInWindow(list, NOW, 30, 0)).toBe(1000)
    expect(tonnageInWindow(list, NOW, 60, 30)).toBe(500)
  })

  it('dayIndex монотонен по дням', () => {
    expect(dayIndex(new Date('2026-07-10T23:00:00')) - dayIndex(new Date('2026-07-09T01:00:00'))).toBe(1)
  })
})

describe('buildInsights — пусто/базово', () => {
  it('пустая история → []', () => {
    expect(buildInsights({ workouts: [], now: NOW })).toEqual([])
  })

  it('ограничивает число инсайтов max', () => {
    // Сформируем ситуацию с несколькими правилами и попросим max=2.
    const list = []
    // серия 3 недели + тренд + рекорд
    for (let i = 0; i < 6; i++) {
      list.push(wk({ id: 'w' + i, at: daysAgo(i * 4), entries: [
        { exId: 'bench', name: 'Жим', group: 'грудь', bench: true, sets: [S(80 + i, 5)] },
      ] }))
    }
    const res = buildInsights({ workouts: list, now: NOW, max: 2 })
    expect(res.length).toBeLessThanOrEqual(2)
  })
})

describe('R1 новый рекорд', () => {
  it('ловит превышение прежнего максимума в контекстной тренировке', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [{ exId: 'bench', name: 'Жим', bench: true, sets: [S(90, 5)] }] }),
      wk({ id: 'old', at: daysAgo(7), entries: [{ exId: 'bench', name: 'Жим', bench: true, sets: [S(80, 5)] }] }),
    ]
    const res = buildInsights({ workouts: list, now: NOW })
    const pr = res.find((i) => i.kind === 'pr')
    expect(pr).toBeTruthy()
    expect(pr.text).toContain('90 кг')
    expect(pr.text).toContain('было 80 кг')
    expect(pr.priority).toBe(100)
  })

  it('первый замер по упражнению рекордом не считается', () => {
    const list = [wk({ id: 'first', at: daysAgo(0), entries: [{ exId: 'bench', name: 'Жим', bench: true, sets: [S(80, 5)] }] })]
    const res = buildInsights({ workouts: list, now: NOW })
    expect(res.find((i) => i.kind === 'pr')).toBeFalsy()
  })
})

describe('R2 обгон друга', () => {
  const list = [
    wk({ id: 'new', at: daysAgo(0), entries: [{ exId: 'bench', name: 'Жим', bench: true, sets: [S(100, 3)] }] }),
    wk({ id: 'old', at: daysAgo(7), entries: [{ exId: 'bench', name: 'Жим', bench: true, sets: [S(85, 3)] }] }),
  ]
  it('фиксирует перешагивание веса соперника', () => {
    const leaderboard = { male: [
      { user_id: 'me', user_name: 'Я', weight: 100 },
      { user_id: 'ivan', user_name: 'Иван', weight: 95 },
    ], female: [] }
    const res = buildInsights({ workouts: list, leaderboard, userId: 'me', now: NOW })
    const ov = res.find((i) => i.kind === 'overtook')
    expect(ov).toBeTruthy()
    expect(ov.text).toContain('Иван')
  })

  it('без снимка лидерборда правило молчит', () => {
    const res = buildInsights({ workouts: list, userId: 'me', now: NOW })
    expect(res.find((i) => i.kind === 'overtook')).toBeFalsy()
  })

  it('соперник ниже прежнего максимума — не обгон', () => {
    const leaderboard = { male: [{ user_id: 'ivan', user_name: 'Иван', weight: 80 }], female: [] }
    const res = buildInsights({ workouts: list, leaderboard, userId: 'me', now: NOW })
    expect(res.find((i) => i.kind === 'overtook')).toBeFalsy()
  })
})

describe('R3 рекордный объём по группе', () => {
  it('срабатывает, когда контекст побил прежний максимум группы', () => {
    const list = [
      wk({ id: 'big', at: daysAgo(0), entries: [{ exId: 'x', group: 'спина', sets: [S(100, 10)] }] }), // 1000
      wk({ id: 'sm', at: daysAgo(7), entries: [{ exId: 'x', group: 'спина', sets: [S(100, 5)] }] }),   // 500
    ]
    const res = buildInsights({ workouts: list, now: NOW })
    const vol = res.find((i) => i.kind === 'volume')
    expect(vol).toBeTruthy()
    expect(vol.text).toContain('спина')
  })

  it('первая тренировка группы не даёт «рекордный объём»', () => {
    const list = [wk({ id: 'only', at: daysAgo(0), entries: [{ exId: 'x', group: 'спина', sets: [S(100, 10)] }] })]
    const res = buildInsights({ workouts: list, now: NOW })
    expect(res.find((i) => i.kind === 'volume')).toBeFalsy()
  })
})

describe('R4 плато в жиме', () => {
  it('нет нового максимума 4 тренировки → плато', () => {
    const list = [0, 1, 2, 3].map((i) =>
      wk({ id: 'w' + i, at: daysAgo(i * 3), entries: [{ exId: 'bench', name: 'Жим', bench: true, sets: [S(80, 5)] }] })
    )
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    const p = res.find((i) => i.kind === 'plateau')
    expect(p).toBeTruthy()
    expect(p.text).toContain('80') // показываем застрявший вес
  })

  it('растущий вес → нет плато', () => {
    const list = [0, 1, 2, 3].map((i) =>
      wk({ id: 'w' + i, at: daysAgo(i * 3), entries: [{ exId: 'bench', name: 'Жим', bench: true, sets: [S(90 - i * 2, 5)] }] })
    )
    // свежая (i=0) = 90 — максимум → не плато
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    expect(res.find((i) => i.kind === 'plateau')).toBeFalsy()
  })
})

describe('R5 забытая группа', () => {
  it('группа не тренирована ≥8 дней → инсайт', () => {
    const list = [
      wk({ id: 'legs', at: daysAgo(20), entries: [{ exId: 'sq', group: 'ноги', sets: [S(100, 5)] }] }),
      wk({ id: 'chest', at: daysAgo(0), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
    ]
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    const n = res.find((i) => i.kind === 'neglect')
    expect(n).toBeTruthy()
    expect(n.text).toContain('Ноги')
    expect(n.text).toContain('20 дней')
  })

  it('«спина» склоняется в винительный: «Спину не тренировал»', () => {
    const list = [
      wk({ id: 'back', at: daysAgo(18), entries: [{ exId: 'row', group: 'спина', sets: [S(100, 5)] }] }),
      wk({ id: 'chest', at: daysAgo(0), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
    ]
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    const n = res.find((i) => i.kind === 'neglect')
    expect(n.text).toContain('Спину не тренировал')
    expect(n.text).not.toContain('Спина не')
  })

  it('всё свежее → правило молчит', () => {
    const list = [wk({ id: 'a', at: daysAgo(1), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] })]
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    expect(res.find((i) => i.kind === 'neglect')).toBeFalsy()
  })
})

describe('R6 тренд тоннажа', () => {
  it('рост >10% за 30 дней', () => {
    const list = [
      wk({ id: 'r1', at: daysAgo(5), entries: [{ exId: 'x', sets: [S(100, 10)] }] }),  // 1000 (окно 0–30)
      wk({ id: 'o1', at: daysAgo(40), entries: [{ exId: 'x', sets: [S(70, 10)] }] }),   // 700  (окно 30–60)
    ]
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    const t = res.find((i) => i.kind === 'trend')
    expect(t).toBeTruthy()
    expect(t.text).toContain('вырос')
  })

  it('изменение <10% → нет инсайта', () => {
    const list = [
      wk({ id: 'r1', at: daysAgo(5), entries: [{ exId: 'x', sets: [S(100, 10)] }] }),
      wk({ id: 'o1', at: daysAgo(40), entries: [{ exId: 'x', sets: [S(98, 10)] }] }),
    ]
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    expect(res.find((i) => i.kind === 'trend')).toBeFalsy()
  })
})

describe('R7 серия', () => {
  it('≥2 недель подряд → инсайт', () => {
    const list = [
      wk({ id: 'w0', at: daysAgo(0), entries: [{ exId: 'x', sets: [S(50, 5)] }] }),
      wk({ id: 'w1', at: daysAgo(7), entries: [{ exId: 'x', sets: [S(50, 5)] }] }),
      wk({ id: 'w2', at: daysAgo(14), entries: [{ exId: 'x', sets: [S(50, 5)] }] }),
    ]
    const res = buildInsights({ workouts: list, now: NOW, max: 5 })
    expect(res.find((i) => i.kind === 'streak')).toBeTruthy()
  })
})

describe('стабильность id/at', () => {
  it('id и at не зависят от now (для «прочитано» в уведомлениях)', () => {
    const list = [
      wk({ id: 'legs', at: daysAgo(20), entries: [{ exId: 'sq', group: 'ноги', sets: [S(100, 5)] }] }),
      wk({ id: 'chest', at: daysAgo(0), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
    ]
    const a = buildInsights({ workouts: list, now: NOW, max: 5 })
    const later = new Date(NOW); later.setHours(later.getHours() + 3)
    const b = buildInsights({ workouts: list, now: later, max: 5 })
    const ids = (r) => r.map((i) => i.id).sort()
    expect(ids(a)).toEqual(ids(b))
    // якорь at общих инсайтов = performed_at свежей тренировки
    const nA = a.find((i) => i.kind === 'neglect')
    expect(nA.at).toBe(list[1].performed_at)
  })
})
