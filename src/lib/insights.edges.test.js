import { describe, it, expect } from 'vitest'
import {
  buildInsights,
  pastSelfInsight,
  workoutTonnage,
  tonnageInWindow,
  dayIndex,
} from './insights.js'

// Края движка инсайтов: метрики, разминка/заминка, кардио, вторичная нагрузка,
// местный день. Базовые сценарии правил — в insights.test.js.

// entries: [{ exId, name, group, sub, sec, metric, bench, sets, phase, legacy, noSets }]
// legacy — снимок без metric (запись до PLAN-metrics); noSets — запись без поля sets.
function wk({ id, at, entries }) {
  return {
    id,
    user_id: 'me',
    performed_at: at,
    created_at: at,
    entries: (entries ?? []).map((e) => {
      const exercise = {
        id: e.exId,
        name: e.name ?? e.exId,
        muscle_group: e.group ?? null,
        submuscle: e.sub ?? null,
        secondary: e.sec ?? [],
        is_bench_lift: Boolean(e.bench),
      }
      if (!e.legacy) exercise.metric = e.metric ?? 'weight'
      const entry = { exercise_id: e.exId, exercise }
      if (e.phase) entry.phase = e.phase
      if (!e.noSets) entry.sets = e.sets ?? []
      return entry
    }),
  }
}
const S = (weight, reps) => ({ weight, reps })
const NOW = new Date('2026-07-10T12:00:00')
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}
const find = (list, kind, opts = {}) =>
  buildInsights({ workouts: list, now: NOW, max: 10, ...opts }).find((i) => i.kind === kind)
const bench = (sets, extra = {}) => ({ exId: 'bench', name: 'Жим', bench: true, sets, ...extra })

describe('тоннаж: метрики и блоки тренировки', () => {
  it('в тоннаж идет только вес × повторы: свой вес, гравитрон, время и дистанция — нет', () => {
    const w = wk({ id: 'a', at: daysAgo(0), entries: [
      { exId: 'bp', sets: [S(100, 5)] },
      { exId: 'dip', metric: 'reps', sets: [S(10, 8)] },
      { exId: 'grav', metric: 'reps', sets: [S(-20, 8)] },
      { exId: 'plank', metric: 'time', sets: [S(20, 60)] },
      { exId: 'run', metric: 'distance', sets: [S(5, 1500)] },
    ] })
    expect(workoutTonnage(w)).toBe(500)
  })

  it('разминка и заминка в тоннаж не идут', () => {
    const w = wk({ id: 'a', at: daysAgo(0), entries: [
      { exId: 'wu', phase: 'warmup', sets: [S(40, 20)] },
      { exId: 'bp', sets: [S(100, 5)] },
      { exId: 'cd', phase: 'cooldown', sets: [S(30, 20)] },
    ] })
    expect(workoutTonnage(w)).toBe(500)
  })

  it('запись без подходов и тренировка без записей дают 0', () => {
    expect(workoutTonnage(wk({ id: 'a', at: daysAgo(0), entries: [{ exId: 'bp', noSets: true }] }))).toBe(0)
    expect(workoutTonnage({ id: 'b' })).toBe(0)
  })

  it('окно: день на границе уходит в дальнее окно, будущее и записи без даты не считаются', () => {
    const list = [
      wk({ id: 'f', at: daysAgo(-2), entries: [{ exId: 'x', sets: [S(10, 10)] }] }),
      wk({ id: 'n', at: null, entries: [{ exId: 'x', sets: [S(200, 10)] }] }),
      wk({ id: 'b', at: daysAgo(30), entries: [{ exId: 'x', sets: [S(50, 10)] }] }),
      wk({ id: 'r', at: daysAgo(29), entries: [{ exId: 'x', sets: [S(100, 10)] }] }),
    ]
    expect(tonnageInWindow(list, NOW, 30, 0)).toBe(1000)
    expect(tonnageInWindow(list, NOW, 60, 30)).toBe(500)
  })
})

describe('день тренировки — местный, а не срез ISO', () => {
  // Пара «начало и конец одних суток» работает в обоих поясах CI: в Москве срез ISO
  // ломает 00:30 (предыдущая дата в UTC), в Лос-Анджелесе — 23:30 (следующая).
  const early = new Date(2026, 6, 10, 0, 30).toISOString()
  const late = new Date(2026, 6, 10, 23, 30).toISOString()

  it('ISO-строка начала и конца суток дает один день', () => {
    expect(dayIndex(early)).toBe(dayIndex(late))
    expect(dayIndex(early)).toBe(dayIndex(new Date(2026, 6, 10, 12)))
  })

  it('соседние сутки — разные дни, даже если между ними 20 минут', () => {
    const before = new Date(2026, 6, 9, 23, 50).toISOString()
    const after = new Date(2026, 6, 10, 0, 10)
    const list = [wk({ id: 'a', at: before, entries: [{ exId: 'x', sets: [S(100, 10)] }] })]
    expect(tonnageInWindow(list, after, 1, 0)).toBe(0)
    expect(tonnageInWindow(list, after, 2, 1)).toBe(1000)
  })

  it('«забытая мышца» считает местные сутки: прошло 7 дней и 20 минут, а сутки — восьмые', () => {
    const now = new Date(2026, 6, 10, 0, 10)
    const list = [
      wk({ id: 'legs', at: new Date(2026, 6, 2, 23, 50).toISOString(), entries: [{ exId: 'sq', group: 'ноги', sets: [S(100, 5)] }] }),
      wk({ id: 'chest', at: new Date(2026, 6, 9, 20, 0).toISOString(), entries: [{ exId: 'bp', group: 'грудь', sets: [S(80, 5)] }] }),
    ]
    expect(find(list, 'neglect', { now }).text).toContain('8 дней')
  })
})

describe('R1 новый рекорд: метрики', () => {
  const pair = (exercise, cur, old) => [
    wk({ id: 'new', at: daysAgo(0), entries: [{ ...exercise, sets: cur }] }),
    wk({ id: 'old', at: daysAgo(7), entries: [{ ...exercise, sets: old }] }),
  ]

  it('повторы: рекорд в штуках, без «кг»', () => {
    const pull = { exId: 'pull', name: 'Подтягивания', metric: 'reps' }
    expect(find(pair(pull, [S(0, 12)], [S(0, 10)]), 'pr').text).toBe('Новый рекорд: Подтягивания — 12 (было 10)')
  })

  it('гравитрон: отрицательный вес не мешает рекорду по повторам', () => {
    const grav = { exId: 'grav', name: 'Гравитрон', metric: 'reps' }
    expect(find(pair(grav, [S(-30, 12)], [S(-30, 10)]), 'pr').text).toBe('Новый рекорд: Гравитрон — 12 (было 10)')
  })

  it('время: рекорд в мм:сс', () => {
    const plank = { exId: 'plank', name: 'Планка', metric: 'time' }
    expect(find(pair(plank, [S(0, 90)], [S(0, 60)]), 'pr').text).toBe('Новый рекорд: Планка — 1:30 (было 1:00)')
  })

  it('дистанция: рекорд — километры, больше секунд на тех же км рекордом не считается', () => {
    const run = { exId: 'run', name: 'Бег', metric: 'distance' }
    expect(find(pair(run, [S(6, 1800)], [S(5, 1500)]), 'pr').text).toBe('Новый рекорд: Бег — 6 км (было 5 км)')
    expect(find(pair(run, [S(5, 1800)], [S(5, 1500)]), 'pr')).toBeUndefined()
  })

  it('равный результат — не рекорд', () => {
    expect(find(pair(bench(), [S(80, 8)], [S(80, 5)]), 'pr')).toBeUndefined()
  })

  it('подходы без результата и запись без id упражнения пропускаются', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [{ exId: null, sets: [S(500, 1)] }, bench([S(0, 10)])] }),
      wk({ id: 'old', at: daysAgo(7), entries: [bench([S(80, 5)])] }),
    ]
    expect(find(list, 'pr')).toBeUndefined()
  })
})

describe('R1: разминка, выбор лучшего, контекст', () => {
  it('тяжелая разминка — не рекорд', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [bench([S(120, 5)], { phase: 'warmup' })] }),
      wk({ id: 'old', at: daysAgo(7), entries: [bench([S(80, 5)])] }),
    ]
    expect(find(list, 'pr')).toBeUndefined()
  })

  it('разминка в прошлом — не база для сравнения', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [bench([S(85, 5)])] }),
      wk({ id: 'old', at: daysAgo(7), entries: [
        bench([S(80, 5)]),
        { exId: 'bench', name: 'Жим', bench: true, phase: 'warmup', sets: [S(100, 5)] },
      ] }),
    ]
    expect(find(list, 'pr').text).toContain('было 80 кг')
  })

  it('из двух рекордов берется больший прирост, какой бы ни шел первым', () => {
    const a = { exId: 'a', name: 'Малый', sets: [S(110, 5)] }
    const b = { exId: 'b', name: 'Большой', sets: [S(150, 5)] }
    const old = wk({ id: 'old', at: daysAgo(7), entries: [{ ...a, sets: [S(100, 5)] }, { ...b, sets: [S(100, 5)] }] })
    const ab = wk({ id: 'new', at: daysAgo(0), entries: [a, b] })
    const ba = wk({ id: 'new', at: daysAgo(0), entries: [b, a] })
    expect(find([ab, old], 'pr').text).toContain('Большой')
    expect(find([ba, old], 'pr').text).toContain('Большой')
  })

  it('при равном приросте выбор не зависит от порядка: меньший id', () => {
    const a = { exId: 'a', name: 'Первый', sets: [S(110, 5)] }
    const b = { exId: 'b', name: 'Второй', sets: [S(110, 5)] }
    const old = wk({ id: 'old', at: daysAgo(7), entries: [{ ...a, sets: [S(100, 5)] }, { ...b, sets: [S(100, 5)] }] })
    expect(find([wk({ id: 'new', at: daysAgo(0), entries: [a, b] }), old], 'pr').id).toBe('ins:pr:new:a')
    expect(find([wk({ id: 'new', at: daysAgo(0), entries: [b, a] }), old], 'pr').id).toBe('ins:pr:new:a')
  })

  it('контекст — выбранная тренировка, а не самая свежая', () => {
    const list = [
      wk({ id: 'fresh', at: daysAgo(0), entries: [bench([S(70, 5)])] }),
      wk({ id: 'peak', at: daysAgo(7), entries: [bench([S(90, 5)])] }),
      wk({ id: 'old', at: daysAgo(14), entries: [bench([S(80, 5)])] }),
    ]
    expect(find(list, 'pr')).toBeUndefined()
    const pr = find(list, 'pr', { contextWorkoutId: 'peak' })
    expect(pr.id).toBe('ins:pr:peak:bench')
    expect(pr.at).toBe(list[1].performed_at)
  })

  it('неизвестный контекст: правила тренировки молчат, общие работают', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [bench([S(100, 3)])] }),
      wk({ id: 'old', at: daysAgo(7), entries: [bench([S(85, 3)])] }),
    ]
    const leaderboard = { male: [{ user_id: 'ivan', weight: 95 }] }
    const kinds = buildInsights({ workouts: list, leaderboard, contextWorkoutId: 'нет', now: NOW, max: 10 }).map((i) => i.kind)
    expect(kinds).toEqual(['streak'])
  })

  it('плоская форма записи из Ленты читается так же, как документ', () => {
    const flat = (id, at, weight) => ({
      id,
      performed_at: at,
      entries: [{ exercise_id: 'b', name: 'Жим лежа', metric: 'weight', muscle_group: 'грудь', is_bench_lift: true, sets: [S(weight, 5)] }],
    })
    const list = [flat('new', daysAgo(0), 90), flat('old', daysAgo(7), 80)]
    expect(find(list, 'pr').text).toBe('Новый рекорд: Жим лежа — 90 кг (было 80 кг)')
    expect(find(list, 'volume').text).toContain('грудь')
  })

  it('безымянное упражнение подписывается прочерком', () => {
    const entry = (weight) => ({ exercise_id: 'x', sets: [S(weight, 5)] })
    const list = [
      { id: 'new', performed_at: daysAgo(0), entries: [entry(90)] },
      { id: 'old', performed_at: daysAgo(7), entries: [entry(80)] },
    ]
    expect(find(list, 'pr').text).toContain('Новый рекорд: — — 90 кг')
  })
})

describe('R2 обгон: края', () => {
  const list = [
    wk({ id: 'new', at: daysAgo(0), entries: [{ exId: 'fly', sets: [S(20, 10)] }, bench([S(100, 3)])] }),
    wk({ id: 'old', at: daysAgo(7), entries: [bench([S(85, 3)])] }),
  ]
  const board = (...male) => ({ male })

  it('жим вторым в тренировке тоже находится; род глагола — по полу', () => {
    const lb = board({ user_id: 'ivan', user_name: 'Иван', weight: 95 })
    expect(find(list, 'overtook', { leaderboard: lb }).text).toBe('Обошел Иван по жиму!')
    expect(find(list, 'overtook', { leaderboard: lb, sex: 'f' }).text).toBe('Обошла Иван по жиму!')
  })

  it('из нескольких обойденных называем самого сильного', () => {
    const lb = board(
      { user_id: 'a', user_name: 'Слабый', weight: 90 },
      { user_id: 'b', user_name: 'Сильный', weight: 98 },
      { user_id: 'c', user_name: 'Средний', weight: 95 },
    )
    const ov = find(list, 'overtook', { leaderboard: lb })
    expect(ov.text).toContain('Сильный')
    expect(ov.id).toBe('ins:overtook:new:b')
  })

  it('соперник без имени — «друга»', () => {
    expect(find(list, 'overtook', { leaderboard: board({ user_id: 'x', weight: 90 }) }).text).toBe('Обошел друга по жиму!')
  })

  it('сам себя не обгоняешь, запись без веса не считается, женский борд не смотрим', () => {
    const lb = { male: [{ user_id: 'me', weight: 95 }, { user_id: 'x', weight: null }] }
    expect(find(list, 'overtook', { leaderboard: lb, userId: 'me' })).toBeUndefined()
    expect(find(list, 'overtook', { leaderboard: { female: [{ user_id: 'y', weight: 95 }] } })).toBeUndefined()
  })

  it('в контексте нет жима, жим без веса или только в разминке — молчит', () => {
    const lb = board({ user_id: 'x', weight: 95 })
    const old = wk({ id: 'old', at: daysAgo(7), entries: [bench([S(85, 3)])] })
    const of = (e) => find([wk({ id: 'new', at: daysAgo(0), entries: [e] }), old], 'overtook', { leaderboard: lb })
    expect(of({ exId: 'fly', sets: [S(100, 3)] })).toBeUndefined()
    expect(of(bench([S(0, 3)]))).toBeUndefined()
    expect(of(bench([S(100, 3)], { phase: 'warmup' }))).toBeUndefined()
  })

  it('первый жим — не обгон', () => {
    const first = [wk({ id: 'new', at: daysAgo(0), entries: [bench([S(100, 3)])] })]
    expect(find(first, 'overtook', { leaderboard: board({ user_id: 'x', weight: 95 }) })).toBeUndefined()
  })
})

describe('R3 рекордный объем: края', () => {
  const ex = (group, sets, extra = {}) => ({ exId: group, group, sets, ...extra })

  it('сравнение идет с максимумом всей истории, а не с прошлым разом', () => {
    const cur = wk({ id: 'c', at: daysAgo(0), entries: [ex('спина', [S(90, 10)])] })
    const prev = wk({ id: 'p', at: daysAgo(7), entries: [ex('спина', [S(50, 10)])] })
    const peak = wk({ id: 'o', at: daysAgo(14), entries: [ex('спина', [S(100, 10)])] })
    expect(find([cur, prev, peak], 'volume')).toBeUndefined()
    expect(find([cur, prev], 'volume').id).toBe('ins:vol:c:спина')
  })

  it('равный объем — не рекорд; старая тренировка меньше прошлого максимума не сбивает его', () => {
    const cur = wk({ id: 'c', at: daysAgo(0), entries: [ex('спина', [S(100, 10)])] })
    const peak = wk({ id: 'p', at: daysAgo(7), entries: [ex('спина', [S(100, 10)])] })
    const small = wk({ id: 's', at: daysAgo(14), entries: [ex('спина', [S(50, 10)])] })
    expect(find([cur, peak, small], 'volume')).toBeUndefined()
  })

  it('из двух групп с рекордом называем ту, где больше тоннаж', () => {
    const old = wk({ id: 'o', at: daysAgo(7), entries: [ex('спина', [S(50, 10)]), ex('грудь', [S(50, 10)])] })
    const ab = wk({ id: 'c', at: daysAgo(0), entries: [ex('спина', [S(60, 10)]), ex('грудь', [S(80, 10)])] })
    const ba = wk({ id: 'c', at: daysAgo(0), entries: [ex('грудь', [S(80, 10)]), ex('спина', [S(60, 10)])] })
    expect(find([ab, old], 'volume').text).toContain('грудь')
    expect(find([ba, old], 'volume').text).toContain('грудь')
  })

  it('группа без тоннажа (свой вес, время, кардио) рекорда объема не дает', () => {
    const cur = wk({ id: 'c', at: daysAgo(0), entries: [
      ex('пресс', [S(0, 30)], { metric: 'reps' }),
      ex('кардио', [S(5, 1500)], { metric: 'distance' }),
    ] })
    const old = wk({ id: 'o', at: daysAgo(7), entries: [
      ex('пресс', [S(0, 20)], { metric: 'reps' }),
      ex('кардио', [S(3, 900)], { metric: 'distance' }),
    ] })
    expect(find([cur, old], 'volume')).toBeUndefined()
  })

  it('разминка в объем группы не идет', () => {
    const cur = wk({ id: 'c', at: daysAgo(0), entries: [
      ex('спина', [S(50, 10)]),
      ex('спина', [S(200, 10)], { exId: 'wu', phase: 'warmup' }),
    ] })
    const old = wk({ id: 'o', at: daysAgo(7), entries: [ex('спина', [S(80, 10)])] })
    expect(find([cur, old], 'volume')).toBeUndefined()
  })

  it('прежняя работа без тоннажа — не база: первая весовая тренировка группы молчит', () => {
    const cur = wk({ id: 'c', at: daysAgo(0), entries: [ex('спина', [S(50, 10)])] })
    const old = wk({ id: 'o', at: daysAgo(7), entries: [ex('спина', [S(0, 10)], { metric: 'reps' })] })
    expect(find([cur, old], 'volume')).toBeUndefined()
  })
})

describe('R4 плато: метрики и окно', () => {
  const series = (sets, extra = {}) =>
    sets.map((x, i) => wk({ id: 'w' + i, at: daysAgo(i * 3), entries: [bench([x], extra)] }))

  it('повторы: потолок в штуках', () => {
    const p = find(series([S(0, 20), S(0, 20), S(0, 20), S(0, 20)], { metric: 'reps' }), 'plateau')
    expect(p.text).toBe('Жим: рекорд (20) не обновлялся 3 тренировки подряд — попробуй сменить схему')
    expect(p.tone).toBe('warn')
  })

  it('время: потолок в мм:сс', () => {
    const p = find(series([S(0, 90), S(0, 90), S(0, 90), S(0, 90)], { metric: 'time' }), 'plateau')
    expect(p.text).toContain('рекорд (1:30)')
  })

  it('гравитрон: меньше помощи на тех же повторах — рост, а не плато', () => {
    const list = series([S(-10, 10), S(-30, 10), S(-30, 10), S(-30, 10)], { metric: 'reps' })
    expect(find(list, 'plateau')).toBeUndefined()
  })

  it('гравитрон: больше помощи на тех же повторах роста не дает', () => {
    const p = find(series([S(-30, 10), S(-30, 10), S(-30, 10), S(-10, 10)], { metric: 'reps' }), 'plateau')
    expect(p.id).toBe('ins:plateau:bench:w3')
  })

  it('три сессии — рано судить, рекорд на границе окна — уже плато', () => {
    expect(find(series([S(80, 5), S(80, 5), S(80, 5)]), 'plateau')).toBeUndefined()
    expect(find(series([S(70, 5), S(70, 5), S(70, 5), S(80, 5)]), 'plateau').text).toContain('3 тренировки')
    expect(find(series([S(70, 5), S(70, 5), S(80, 5), S(70, 5)]), 'plateau')).toBeUndefined()
  })

  it('длинная серия склоняется: 5 тренировок', () => {
    const list = series([S(70, 5), S(70, 5), S(70, 5), S(70, 5), S(70, 5), S(80, 5)])
    expect(find(list, 'plateau').text).toContain('5 тренировок подряд')
  })

  it('весь жим без веса: текст без скобок с потолком', () => {
    const p = find(series([S(0, 10), S(0, 10), S(0, 10), S(0, 10)]), 'plateau')
    expect(p.text).toBe('Жим: рекорд не обновлялся 3 тренировки подряд — попробуй сменить схему')
  })

  it('жим в разминке сессией плато не считается', () => {
    const list = series([S(80, 5), S(80, 5), S(80, 5)])
    list.push(wk({ id: 'wu', at: daysAgo(9), entries: [bench([S(80, 5)], { phase: 'warmup' })] }))
    expect(find(list, 'plateau')).toBeUndefined()
  })

  it('жим только в разминке — нечего считать', () => {
    expect(find(series([S(80, 5), S(80, 5), S(80, 5), S(80, 5)], { phase: 'warmup' }), 'plateau')).toBeUndefined()
  })

  it('легаси-снимок без metric попадает в окно, когда это те же повторы', () => {
    const list = series([S(0, 20), S(0, 20), S(0, 20)], { metric: 'reps' })
    list.push(wk({ id: 'lg', at: daysAgo(9), entries: [bench([S(0, 20)], { legacy: true })] }))
    expect(find(list, 'plateau').text).toContain('3 тренировки')
  })

  it('запись жима без подходов не ломает счет', () => {
    const list = series([S(80, 5), S(80, 5), S(80, 5)]).map((w, i) =>
      wk({ id: 'k' + i, at: daysAgo((i + 1) * 3), entries: [bench(w.entries[0].sets)] }))
    list.unshift(wk({ id: 'empty', at: daysAgo(0), entries: [{ exId: 'bench', name: 'Жим', bench: true, noSets: true }] }))
    expect(find(list, 'plateau').id).toBe('ins:plateau:bench:k2')
  })
})

describe('R5 забытая мышца: границы и не-мышцы', () => {
  const legs = (n, extra = {}) => wk({ id: 'legs', at: daysAgo(n), entries: [{ exId: 'sq', group: 'ноги', sets: [S(100, 5)], ...extra }] })
  const today = (entries) => wk({ id: 'today', at: daysAgo(0), entries })
  const chest = { exId: 'bp', group: 'грудь', sets: [S(80, 5)] }

  it('порог: 7 дней молчит, 8 — срабатывает', () => {
    expect(find([legs(7), today([chest])], 'neglect')).toBeUndefined()
    expect(find([legs(8), today([chest])], 'neglect').text).toBe('Квадрицепс не тренировал 8 дней — пора')
  })

  it('склонение дней и род по полу', () => {
    expect(find([legs(21), today([chest])], 'neglect').text).toContain('21 день')
    expect(find([legs(22), today([chest])], 'neglect', { sex: 'f' }).text).toBe('Квадрицепс не тренировала 22 дня — пора')
  })

  it('вторичная нагрузка таймер не сбрасывает', () => {
    const list = [legs(20), today([{ ...chest, sec: ['quads'] }])]
    expect(find(list, 'neglect').id).toBe('ins:neglect:quads')
  })

  it('упражнение в разминке и заминке таймер не сбрасывает', () => {
    const list = [
      legs(20),
      today([chest, { exId: 'sq', group: 'ноги', phase: 'warmup', sets: [S(40, 10)] }, { exId: 'lp', group: 'ноги', phase: 'cooldown', sets: [S(40, 10)] }]),
    ]
    expect(find(list, 'neglect').text).toContain('20 дней')
  })

  it('основная работа таймер сбрасывает', () => {
    expect(find([legs(20), today([chest, { exId: 'sq', group: 'ноги', sets: [S(40, 10)] }])], 'neglect')).toBeUndefined()
  })

  it('кардио и разминка — не мышцы, даже если давно не было', () => {
    const list = [
      wk({ id: 'run', at: daysAgo(30), entries: [{ exId: 'run', group: 'кардио', metric: 'distance', sets: [S(5, 1500)] }] }),
      wk({ id: 'wu', at: daysAgo(40), entries: [{ exId: 'wu', group: 'разминка', metric: 'time', sets: [S(0, 300)] }] }),
      today([chest]),
    ]
    expect(find(list, 'neglect')).toBeUndefined()
  })

  it('из нескольких выбирается самая давняя; при равенстве — меньший слаг', () => {
    const lats = (n) => wk({ id: 'back', at: daysAgo(n), entries: [{ exId: 'row', group: 'спина', sets: [S(80, 5)] }] })
    expect(find([legs(30), lats(20), today([chest])], 'neglect').id).toBe('ins:neglect:quads')
    expect(find([legs(20), lats(20), today([chest])], 'neglect').id).toBe('ins:neglect:lats')
  })
})

describe('R6 тренд тоннажа: края', () => {
  const pair = (cur, old) => [
    wk({ id: 'r', at: daysAgo(5), entries: [{ exId: 'x', sets: [S(cur, 10)] }] }),
    wk({ id: 'o', at: daysAgo(40), entries: [{ exId: 'x', sets: [S(old, 10)] }] }),
  ]

  it('спад: мягкое предупреждение с низким приоритетом', () => {
    const t = find(pair(70, 100), 'trend')
    expect(t).toMatchObject({ emoji: '📉', tone: 'warn', priority: 45, text: 'За 30 дней тоннаж снизился на 30%' })
  })

  it('рост: хорошая новость с приоритетом выше', () => {
    const t = find(pair(100, 50), 'trend')
    expect(t).toMatchObject({ emoji: '📊', tone: 'good', priority: 60, text: 'За 30 дней тоннаж вырос на 100%' })
  })

  it('порог 10%: ровно 10 в обе стороны срабатывает, 9 — нет', () => {
    expect(find(pair(110, 100), 'trend').text).toContain('вырос на 10%')
    expect(find(pair(90, 100), 'trend').text).toContain('снизился на 10%')
    expect(find(pair(109, 100), 'trend')).toBeUndefined()
    expect(find(pair(91, 100), 'trend')).toBeUndefined()
  })

  it('пустое окно с любой стороны — сравнивать не с чем', () => {
    expect(find([pair(100, 50)[0]], 'trend')).toBeUndefined()
    expect(find([pair(100, 50)[1]], 'trend')).toBeUndefined()
  })

  it('упражнения без веса и разминка тренд не двигают', () => {
    const list = [
      wk({ id: 'r', at: daysAgo(5), entries: [
        { exId: 'x', sets: [S(100, 10)] },
        { exId: 'run', metric: 'distance', sets: [S(50, 9000)] },
        { exId: 'wu', phase: 'warmup', sets: [S(100, 100)] },
      ] }),
      wk({ id: 'o', at: daysAgo(40), entries: [{ exId: 'x', sets: [S(100, 10)] }] }),
    ]
    expect(find(list, 'trend')).toBeUndefined()
  })
})

describe('R7 серия: текст и порог', () => {
  const weeks = (n) => Array.from({ length: n }, (_, i) =>
    wk({ id: 'w' + i, at: daysAgo(i * 7), entries: [{ exId: 'x', sets: [S(50, 5)] }] }))

  it('одна неделя — еще не серия', () => {
    expect(find(weeks(1), 'streak')).toBeUndefined()
  })

  it('склонение недель и стабильный id', () => {
    expect(find(weeks(2), 'streak').text).toBe('2 недели подряд с тренировками — серия держится')
    const five = find(weeks(5), 'streak')
    expect(five.text).toContain('5 недель подряд')
    expect(five.id).toBe('ins:streak:5')
  })
})

describe('R8 себя прошлого: метрики', () => {
  const past = (exercise, cur, old, oldDays = 365) => {
    const ctx = wk({ id: 'new', at: daysAgo(0), entries: [{ ...exercise, sets: cur }] })
    const prev = wk({ id: 'old', at: daysAgo(oldDays), entries: [{ ...exercise, sets: old }] })
    return pastSelfInsight([ctx, prev], ctx)
  }
  const ex = { exId: 'bench', name: 'Жим' }

  it('время — в мм:сс', () => {
    const r = past({ exId: 'plank', name: 'Планка', metric: 'time' }, [S(0, 90)], [S(0, 60)])
    expect(r.text).toBe('Планка: 1:00 → 1:30 — +50% за год')
  })

  it('дистанция — в км', () => {
    const r = past({ exId: 'run', name: 'Бег', metric: 'distance' }, [S(6, 1800)], [S(5, 1500)])
    expect(r.text).toBe('Бег: 5 км → 6 км — +20% за год')
  })

  it('гравитрон — сравниваем повторы, отрицательный вес не мешает', () => {
    const r = past({ exId: 'grav', name: 'Гравитрон', metric: 'reps' }, [S(-20, 12)], [S(-40, 10)])
    expect(r.text).toBe('Гравитрон: 10 повт. → 12 повт. — +20% за год')
  })

  it('поля инсайта: упражнение, период и контекст в id', () => {
    const r = past(ex, [S(85, 6)], [S(70, 6)])
    expect(r).toMatchObject({ id: 'ins:past-self:new:bench:365', exerciseId: 'bench', kind: 'past-self', tone: 'good' })
  })

  it('дробный вес печатается с точкой', () => {
    expect(past(ex, [S(62.5, 6)], [S(50, 6)]).text).toBe('Жим: 50 → 62.5 кг при 6 повт. — +25% за год')
  })

  it('вес: внутри числа повторов берется лучший подход с обеих сторон', () => {
    const r = past(ex, [S(80, 6), S(85, 6)], [S(70, 6), S(60, 6)])
    expect(r.text).toContain('70 → 85 кг при 6 повт.')
  })

  it('вес: из нескольких сравнимых повторов выбираем лучший прирост', () => {
    const r = past(ex, [S(80, 8), S(90, 5)], [S(75, 8), S(60, 5)])
    expect(r.text).toContain('60 → 90 кг при 5 повт.')
    expect(r.text).toContain('+50%')
    const flipped = past(ex, [S(90, 5), S(80, 8)], [S(60, 5), S(75, 8)])
    expect(flipped.text).toContain('+50%')
  })

  it('вес: пустые подходы отбрасываются', () => {
    expect(past(ex, [S(0, 6), S(85, 0)], [S(70, 6)])).toBeNull()
    expect(past(ex, [S(85, 6)], [S(0, 6), S(70, 0)])).toBeNull()
  })

  it('вес: нет роста или прирост ниже порога — молчим', () => {
    expect(past(ex, [S(70, 6)], [S(70, 6)])).toBeNull()
    expect(past(ex, [S(60, 6)], [S(70, 6)])).toBeNull()
    expect(past(ex, [S(103, 6)], [S(100, 6)])).toBeNull()
  })

  it('порог прироста настраивается', () => {
    const ctx = wk({ id: 'new', at: daysAgo(0), entries: [{ ...ex, sets: [S(103, 6)] }] })
    const old = wk({ id: 'old', at: daysAgo(365), entries: [{ ...ex, sets: [S(100, 6)] }] })
    expect(pastSelfInsight([ctx, old], ctx, { minGainPct: 3 }).text).toContain('+3%')
  })

  it('не-вес: прежний результат нулевой или рост меньше — молчим', () => {
    const plank = { exId: 'plank', metric: 'time' }
    expect(past(plank, [S(0, 90)], [S(0, 0)])).toBeNull()
    expect(past(plank, [S(0, 60)], [S(0, 90)])).toBeNull()
  })

  it('записи без подходов не ломают расчет', () => {
    const ctx = wk({ id: 'new', at: daysAgo(0), entries: [{ ...ex, noSets: true }] })
    const old = wk({ id: 'old', at: daysAgo(365), entries: [{ ...ex, sets: [S(70, 6)] }] })
    expect(pastSelfInsight([ctx, old], ctx)).toBeNull()
    const ctx2 = wk({ id: 'new', at: daysAgo(0), entries: [{ ...ex, sets: [S(85, 6)] }] })
    const old2 = wk({ id: 'old', at: daysAgo(365), entries: [{ ...ex, noSets: true }] })
    expect(pastSelfInsight([ctx2, old2], ctx2)).toBeNull()
  })
})

describe('R8: выбор точки сравнения', () => {
  const ex = { exId: 'bench', name: 'Жим' }
  const at = (n, weight, id = 'd' + n) => wk({ id, at: daysAgo(n), entries: [{ ...ex, sets: [S(weight, 6)] }] })
  const ctx = at(0, 100, 'new')

  it('без контекста или даты — null', () => {
    expect(pastSelfInsight([ctx], null)).toBeNull()
    expect(pastSelfInsight([ctx], { id: 'x', entries: [] })).toBeNull()
  })

  it('берется запись, ближайшая к году', () => {
    expect(pastSelfInsight([ctx, at(350, 80), at(370, 50)], ctx).text).toContain('50 → 100 кг')
  })

  it('две записи на равном расстоянии от года — более свежая', () => {
    expect(pastSelfInsight([ctx, at(370, 50), at(360, 80)], ctx).text).toContain('80 → 100 кг')
  })

  it('допуск года — 45 дней, полгода — 30: за границей сравнения нет', () => {
    expect(pastSelfInsight([ctx, at(320, 80)], ctx).text).toContain('за год')
    expect(pastSelfInsight([ctx, at(319, 80)], ctx)).toBeNull()
    expect(pastSelfInsight([ctx, at(210, 80)], ctx).text).toContain('за 6 месяцев')
    expect(pastSelfInsight([ctx, at(150, 80)], ctx).text).toContain('за 6 месяцев')
    expect(pastSelfInsight([ctx, at(149, 80)], ctx)).toBeNull()
  })

  it('год без роста — откат на полгода', () => {
    expect(pastSelfInsight([ctx, at(180, 80), at(365, 100)], ctx).text).toContain('за 6 месяцев')
  })

  it('есть рост за год — полгода не смотрим, даже если там больше', () => {
    expect(pastSelfInsight([ctx, at(180, 50), at(365, 90)], ctx).text).toContain('за год')
  })

  it('запись новее контекста не сравнивается', () => {
    const old = at(365, 100, 'ctx')
    expect(pastSelfInsight([at(0, 50, 'later'), old], old)).toBeNull()
  })

  it('запись без даты пропускается', () => {
    expect(pastSelfInsight([ctx, at(365, 80), { id: 'n', performed_at: null, entries: [] }], ctx).text).toContain('за год')
  })

  it('разминка не сравнивается ни с той, ни с другой стороны', () => {
    const wu = (id, n, weight) => wk({ id, at: daysAgo(n), entries: [{ ...ex, phase: 'warmup', sets: [S(weight, 6)] }] })
    expect(pastSelfInsight([wu('new', 0, 100), at(365, 50)], wu('new', 0, 100))).toBeNull()
    expect(pastSelfInsight([ctx, wu('old', 365, 50)], ctx)).toBeNull()
  })

  it('запись контекста без id упражнения пропускается', () => {
    const c = wk({ id: 'new', at: daysAgo(0), entries: [{ exId: null, sets: [S(100, 6)] }] })
    expect(pastSelfInsight([c], c)).toBeNull()
  })

  it('легаси-снимок без metric сравним, когда это те же повторы', () => {
    const c = wk({ id: 'new', at: daysAgo(0), entries: [{ exId: 'p', name: 'Отжимания', metric: 'reps', sets: [S(0, 30)] }] })
    const o = wk({ id: 'old', at: daysAgo(365), entries: [{ exId: 'p', name: 'Отжимания', legacy: true, sets: [S(0, 20)] }] })
    expect(pastSelfInsight([c, o], c).text).toContain('20 повт. → 30 повт.')
  })

  it('из нескольких упражнений — лучший прирост, при равенстве меньший id', () => {
    const c = wk({ id: 'new', at: daysAgo(0), entries: [
      { exId: 'b', name: 'Бэ', sets: [S(120, 6)] },
      { exId: 'a', name: 'А', sets: [S(120, 6)] },
      { exId: 'c', name: 'Цэ', sets: [S(110, 6)] },
    ] })
    const o = wk({ id: 'old', at: daysAgo(365), entries: [
      { exId: 'b', name: 'Бэ', sets: [S(100, 6)] },
      { exId: 'a', name: 'А', sets: [S(100, 6)] },
      { exId: 'c', name: 'Цэ', sets: [S(100, 6)] },
    ] })
    expect(pastSelfInsight([c, o], c).exerciseId).toBe('a')
  })
})

describe('buildInsights: движок', () => {
  it('без тренировок и без аргументов — пусто', () => {
    expect(buildInsights()).toEqual([])
    expect(buildInsights({ now: NOW })).toEqual([])
  })

  it('одна тренировка: не падает и молчит', () => {
    const one = wk({ id: 'a', at: daysAgo(0), entries: [bench([S(80, 5)])] })
    expect(buildInsights({ workouts: [one], now: NOW })).toEqual([])
  })

  it('удаленные тренировки не участвуют', () => {
    const list = [
      { ...wk({ id: 'gone', at: daysAgo(0), entries: [bench([S(120, 5)])] }), _deleted: 1 },
      wk({ id: 'new', at: daysAgo(1), entries: [bench([S(80, 5)])] }),
    ]
    expect(buildInsights({ workouts: list, now: NOW })).toEqual([])
  })

  it('сортирует по важности и режет по max', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [bench([S(100, 3)], { group: 'грудь' })] }),
      wk({ id: 'old', at: daysAgo(7), entries: [bench([S(85, 3)], { group: 'грудь' })] }),
    ]
    const leaderboard = { male: [{ user_id: 'ivan', user_name: 'Иван', weight: 95 }] }
    const kinds = (max) => buildInsights({ workouts: list, leaderboard, now: NOW, max }).map((i) => i.kind)
    expect(kinds(3)).toEqual(['pr', 'overtook', 'volume'])
    expect(kinds(1)).toEqual(['pr'])
  })

  it('max 0 и отрицательный — пусто', () => {
    const list = [
      wk({ id: 'new', at: daysAgo(0), entries: [bench([S(100, 3)])] }),
      wk({ id: 'old', at: daysAgo(7), entries: [bench([S(85, 3)])] }),
    ]
    expect(buildInsights({ workouts: list, now: NOW, max: 0 })).toEqual([])
    expect(buildInsights({ workouts: list, now: NOW, max: -1 })).toEqual([])
  })
})
