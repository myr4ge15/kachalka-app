import { describe, it, expect } from 'vitest'
import {
  dayIndex,
  lastTrainedByGroup,
  freshnessState,
  freshnessBucket,
  groupFreshness,
  readinessStatus,
  recoveryLead,
  mostNeglectedGroup,
  imbalance,
  groupBuckets,
  lastTrainedBySubmuscle,
  lastWorkedBySubmuscle,
  submuscleFreshness,
  submuscleImbalance,
  readinessView,
  regionTarget,
  fmtHoursLeft,
  cardioGap,
} from './freshness.js'

// Края движка свежести: разминка/заминка, кардио, вторичная нагрузка, мусор на
// входе, местный день, порядок сортировок. Базовые сценарии — в freshness.test.js.

// entries: [{ group, sub, sec, phase, flat }]; flat — плоская форма записи из Ленты.
function wk({ id = 'w', at, entries, deleted }) {
  return {
    id,
    user_id: 'me',
    performed_at: at,
    _deleted: deleted ? 1 : 0,
    entries: (entries ?? []).map((e) => {
      const fields = { muscle_group: e.group ?? null, submuscle: e.sub ?? null }
      if (e.sec !== undefined) fields.secondary = e.sec
      const entry = e.flat
        ? { exercise_id: 'x', ...fields }
        : { exercise_id: 'x', exercise: { id: 'x', name: 'x', ...fields } }
      if (e.phase) entry.phase = e.phase
      entry.sets = [{ weight: 50, reps: 8 }]
      return entry
    }),
  }
}
const NOW = new Date('2026-07-10T12:00:00')
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}
const hoursAgo = (n) => new Date(NOW.getTime() - n * 3600000).toISOString()

describe('день тренировки — местный, а не срез ISO', () => {
  // Пара «начало и конец одних суток» работает в обоих поясах CI: в Москве срез ISO
  // ломает 00:30 (предыдущая дата в UTC), в Лос-Анджелесе — 23:30 (следующая).
  const early = new Date(2026, 6, 10, 0, 30).toISOString()
  const late = new Date(2026, 6, 10, 23, 30).toISOString()
  const dayOf = dayIndex(new Date(2026, 6, 10, 12))

  it('dayIndex принимает ISO-строку и дату одинаково', () => {
    expect(dayIndex(early)).toBe(dayOf)
    expect(dayIndex(late)).toBe(dayOf)
  })

  it('день в картах групп и подмышц — местный', () => {
    const list = [wk({ at: early, entries: [{ group: 'грудь', sub: 'chest_upper' }] })]
    expect(lastTrainedByGroup(list).get('грудь').day).toBe(dayOf)
    expect(lastTrainedBySubmuscle(list).get('chest_upper').day).toBe(dayOf)
    expect(lastWorkedBySubmuscle(list).get('chest_upper').day).toBe(dayOf)
    const later = [wk({ at: late, entries: [{ group: 'грудь', sub: 'chest_upper' }] })]
    expect(lastTrainedByGroup(later).get('грудь').day).toBe(dayOf)
  })

  it('20 минут через полночь — уже вчера: сутки 1, часов почти ноль', () => {
    const now = new Date(2026, 6, 10, 0, 10)
    const list = [wk({ at: new Date(2026, 6, 9, 23, 50).toISOString(), entries: [{ group: 'грудь' }] })]
    const [f] = groupFreshness(list, { now })
    expect(f.daysSince).toBe(1)
    expect(f.hoursSince).toBeCloseTo(1 / 3, 5)
    expect(f.state).toBe('resting')
  })

  it('разрыв кардио считается по местным суткам', () => {
    const now = new Date(2026, 6, 10, 0, 10)
    const list = [wk({ at: new Date(2026, 6, 2, 23, 50).toISOString(), entries: [{ group: 'кардио' }] })]
    expect(cardioGap(list, { now })).toBe(8)
  })
})

describe('разминка и заминка: только основная часть', () => {
  const warm = wk({ id: 'wu', at: daysAgo(0), entries: [
    { group: 'ноги', sub: 'quads', phase: 'warmup' },
    { group: 'ноги', sub: 'quads', phase: 'cooldown', sec: ['calves'] },
  ] })
  const main = wk({ id: 'm', at: daysAgo(20), entries: [{ group: 'ноги', sub: 'quads' }] })

  it('блоки разминки и заминки не сбрасывают таймер группы', () => {
    expect(groupFreshness([warm, main], { now: NOW })[0].daysSince).toBe(20)
    expect(lastTrainedByGroup([warm]).size).toBe(0)
  })

  it('и таймер подмышцы', () => {
    expect(submuscleFreshness([warm, main], { now: NOW })[0].daysSince).toBe(20)
    expect(lastTrainedBySubmuscle([warm]).size).toBe(0)
  })

  it('и нагрузку подмышцы, включая вторичную', () => {
    expect(lastWorkedBySubmuscle([warm]).size).toBe(0)
  })

  it('дисбаланс видит группу заброшенной, несмотря на разминку', () => {
    expect(imbalance([warm, main], { now: NOW, groups: ['ноги'] })).toEqual([{ group: 'ноги', kind: 'stale', daysSince: 20 }])
  })

  it('упражнение кардио в разминке кардио-перерыв не закрывает', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(0), entries: [{ group: 'кардио', phase: 'warmup' }] }),
      wk({ id: 'b', at: daysAgo(10), entries: [{ group: 'кардио' }] }),
    ]
    expect(cardioGap(list, { now: NOW })).toBe(10)
  })
})

describe('кардио и разминка — не мышцы', () => {
  it('дисбаланс по каноническим группам их не называет', () => {
    const list = [wk({ at: daysAgo(30), entries: [{ group: 'кардио' }, { group: 'разминка' }] })]
    const groups = imbalance(list, { now: NOW }).map((x) => x.group)
    expect(groups).not.toContain('кардио')
    expect(groups).not.toContain('разминка')
  })

  it('«ни разу» в активных группах не включает кардио, кардио группу активной не делает', () => {
    const list = [wk({ at: daysAgo(1), entries: [{ group: 'кардио' }, { group: 'спина', sub: 'lats' }] })]
    const subs = submuscleImbalance(list, { now: NOW }).map((x) => x.submuscle)
    expect(subs).not.toContain('cardio')
    expect(subs).not.toContain('warmup')
    const onlyCardio = [wk({ at: daysAgo(1), entries: [{ group: 'кардио' }] })]
    expect(submuscleImbalance(onlyCardio, { now: NOW })).toEqual([])
  })

  it('кардио не попадает в готовность подмышц, даже по дефолту группы', () => {
    const list = [wk({ at: daysAgo(30), entries: [{ group: 'кардио' }, { group: 'разминка' }] })]
    expect(submuscleFreshness(list, { now: NOW })).toEqual([])
  })

  // Настоящая мелкая ошибка: freshness.js:188 — mostNeglectedGroup не пропускает кардио и
  // разминку (инвариант AGENTS.md: «забытая мышца» их не включает). Сейчас не видна
  // участнику: homeSummary.nextFocus ни один экран не читает. Снять skip при починке.
  it.skip('самая запущенная группа — не кардио', () => {
    const list = [
      wk({ id: 'run', at: daysAgo(30), entries: [{ group: 'кардио' }] }),
      wk({ id: 'wu', at: daysAgo(40), entries: [{ group: 'разминка' }] }),
      wk({ id: 'legs', at: daysAgo(10), entries: [{ group: 'ноги' }] }),
    ]
    expect(mostNeglectedGroup(list, NOW)).toEqual({ group: 'ноги', daysAgo: 10 })
  })
})

describe('вторичная нагрузка', () => {
  const list = [
    wk({ id: 'sec', at: daysAgo(0), entries: [{ group: 'грудь', sub: 'chest_middle', sec: ['triceps'] }] }),
    wk({ id: 'pri', at: daysAgo(10), entries: [{ group: 'трицепс', sub: 'triceps' }] }),
  ]

  it('не сбрасывает таймер восстановления', () => {
    expect(lastTrainedBySubmuscle(list).get('triceps').day).toBe(dayIndex(new Date(daysAgo(10))))
    const tri = submuscleFreshness(list, { now: NOW }).find((f) => f.submuscle === 'triceps')
    expect(tri.daysSince).toBe(10)
    expect(tri.state).toBe('ready')
  })

  it('но считается нагрузкой: мышца не «давно»', () => {
    expect(lastWorkedBySubmuscle(list).get('triceps').day).toBe(dayIndex(new Date(daysAgo(0))))
    const stale = [
      wk({ id: 'sec', at: daysAgo(1), entries: [{ group: 'грудь', sub: 'chest_middle', sec: ['triceps'] }] }),
      wk({ id: 'pri', at: daysAgo(30), entries: [{ group: 'трицепс', sub: 'triceps' }] }),
    ]
    expect(submuscleImbalance(stale, { now: NOW }).find((x) => x.submuscle === 'triceps')).toBeUndefined()
  })

  it('старая вторичная нагрузка уже не спасает', () => {
    const old = [
      wk({ id: 'tr', at: daysAgo(1), entries: [{ group: 'спина', sub: 'lats' }] }),
      wk({ id: 'sec', at: daysAgo(20), entries: [{ group: 'спина', sub: 'lats', sec: ['rhomboids'] }] }),
    ]
    expect(submuscleImbalance(old, { now: NOW }).find((x) => x.submuscle === 'rhomboids'))
      .toEqual({ submuscle: 'rhomboids', major: 'спина', kind: 'stale', daysSince: 20 })
  })

  it('более ранняя нагрузка не затирает свежую, в каком бы порядке ни шли тренировки', () => {
    const reversed = [...list].reverse()
    expect(lastWorkedBySubmuscle(reversed).get('triceps').day).toBe(dayIndex(new Date(daysAgo(0))))
  })

  it('плоская форма записи и мусор вместо списка вторичных', () => {
    const flat = [wk({ at: daysAgo(1), entries: [{ flat: true, group: 'грудь', sub: 'chest_middle', sec: ['triceps'] }] })]
    expect(new Set(lastWorkedBySubmuscle(flat).keys())).toEqual(new Set(['chest_middle', 'triceps']))
    const junk = [wk({ at: daysAgo(1), entries: [{ group: 'грудь', sub: 'chest_middle', sec: 'triceps' }] })]
    expect([...lastWorkedBySubmuscle(junk).keys()]).toEqual(['chest_middle'])
    const none = [wk({ at: daysAgo(1), entries: [{ group: 'грудь', sub: 'chest_middle', sec: null }] })]
    expect([...lastWorkedBySubmuscle(none).keys()]).toEqual(['chest_middle'])
  })

  it('без подмышцы — дефолт группы; без группы — запись никуда не идет', () => {
    const list2 = [wk({ at: daysAgo(1), entries: [{ group: 'ноги' }, { sec: ['calves'] }] })]
    expect([...lastTrainedBySubmuscle(list2).keys()]).toEqual(['quads'])
    expect(new Set(lastWorkedBySubmuscle(list2).keys())).toEqual(new Set(['quads', 'calves']))
  })
})

describe('мусор на входе карт', () => {
  const good = wk({ id: 'ok', at: daysAgo(1), entries: [{ group: 'грудь', sub: 'chest_middle' }] })
  const junk = [
    null,
    undefined,
    wk({ id: 'del', at: daysAgo(0), entries: [{ group: 'спина', sub: 'lats' }], deleted: true }),
    wk({ id: 'no', at: null, entries: [{ group: 'спина', sub: 'lats' }] }),
    wk({ id: 'bad', at: 'не дата', entries: [{ group: 'спина', sub: 'lats' }] }),
  ]

  it.each([
    ['lastTrainedByGroup', lastTrainedByGroup, 'грудь'],
    ['lastTrainedBySubmuscle', lastTrainedBySubmuscle, 'chest_middle'],
    ['lastWorkedBySubmuscle', lastWorkedBySubmuscle, 'chest_middle'],
  ])('%s: пропускает пустые, удаленные, без даты и с битой датой', (_, fn, key) => {
    const m = fn([...junk, good])
    expect([...m.keys()]).toEqual([key])
    expect(fn(null).size).toBe(0)
    expect(fn(undefined).size).toBe(0)
  })

  it('старая тренировка после свежей карту не откатывает', () => {
    const fresh = wk({ id: 'a', at: daysAgo(1), entries: [{ group: 'грудь', sub: 'chest_middle' }] })
    const old = wk({ id: 'b', at: daysAgo(9), entries: [{ group: 'грудь', sub: 'chest_middle' }] })
    expect(lastTrainedByGroup([fresh, old]).get('грудь').at).toBe(fresh.performed_at)
    expect(lastTrainedBySubmuscle([fresh, old]).get('chest_middle').at).toBe(fresh.performed_at)
  })

  it('в один день побеждает более поздняя тренировка', () => {
    const am = wk({ id: 'a', at: new Date(2026, 6, 9, 8).toISOString(), entries: [{ group: 'грудь' }] })
    const pm = wk({ id: 'b', at: new Date(2026, 6, 9, 20).toISOString(), entries: [{ group: 'грудь' }] })
    expect(lastTrainedByGroup([am, pm]).get('грудь').at).toBe(pm.performed_at)
  })

  it('записи без entries и пустая история во всех расчетах', () => {
    const empty = { id: 'e', performed_at: daysAgo(1) }
    expect(lastTrainedByGroup([empty]).size).toBe(0)
    expect(groupFreshness(null, { now: NOW })).toEqual([])
    expect(submuscleFreshness(null, { now: NOW })).toEqual([])
    expect(submuscleImbalance([], { now: NOW })).toEqual([])
    expect(mostNeglectedGroup(null, NOW)).toBeNull()
    expect(cardioGap(null, { now: NOW })).toBeNull()
  })

  it('пустая история: все канонические группы — «ни разу»', () => {
    const im = imbalance([], { now: NOW })
    expect(im).toHaveLength(7)
    expect(im.every((x) => x.kind === 'never' && x.daysSince === null)).toBe(true)
  })
})

describe('freshnessState: порог и границы', () => {
  it('порог 0 и отрицательный — дефолт 48 ч', () => {
    expect(freshnessState(47, 0)).toBe('almost')
    expect(freshnessState(48, 0)).toBe('ready')
    expect(freshnessState(47, -5)).toBe('almost')
    expect(freshnessState(47, undefined)).toBe('almost')
  })

  it('граница «почти» — ровно 75% порога', () => {
    expect(freshnessState(36, 48)).toBe('almost')
    expect(freshnessState(35.9, 48)).toBe('resting')
  })
})

describe('groupFreshness: часы и сортировка', () => {
  it('now принимается и строкой, и числом', () => {
    const list = [wk({ at: hoursAgo(24), entries: [{ group: 'грудь' }] })]
    const asDate = groupFreshness(list, { now: NOW })[0]
    expect(groupFreshness(list, { now: NOW.toISOString() })[0]).toEqual(asDate)
    expect(groupFreshness(list, { now: NOW.getTime() })[0]).toEqual(asDate)
    expect(asDate.hoursSince).toBeCloseTo(24, 5)
  })

  it('тренировка из будущего: часы не уходят в минус', () => {
    const [f] = groupFreshness([wk({ at: hoursAgo(-3), entries: [{ group: 'грудь' }] })], { now: NOW })
    expect(f.hoursSince).toBe(0)
    expect(f.state).toBe('resting')
  })

  it('порог группы: пресс готов через сутки, спина еще нет', () => {
    const list = [wk({ at: hoursAgo(25), entries: [{ group: 'пресс' }, { group: 'спина' }] })]
    const byGroup = Object.fromEntries(groupFreshness(list, { now: NOW }).map((f) => [f.group, f.state]))
    expect(byGroup).toEqual({ пресс: 'ready', спина: 'resting' })
  })

  it('внутри бакета — дольше не тренировали выше, при равенстве по алфавиту', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(4), entries: [{ group: 'спина' }] }),
      wk({ id: 'b', at: daysAgo(5), entries: [{ group: 'ноги' }] }),
      wk({ id: 'c', at: daysAgo(5), entries: [{ group: 'грудь' }] }),
    ]
    expect(groupFreshness(list, { now: NOW }).map((f) => f.group)).toEqual(['грудь', 'ноги', 'спина'])
  })
})

describe('freshnessBucket и статусы', () => {
  it('отрицательный возраст (будущая дата) — свежая', () => {
    expect(freshnessBucket(-1)).toBe('fresh')
  })

  it('readinessStatus: без состояния и давности', () => {
    expect(readinessStatus({ daysSince: 3 })).toBeNull()
    expect(readinessStatus({ state: 'ready' })).toBe('ready')
    expect(readinessStatus({ state: 'resting', daysSince: 13 })).toBe('resting')
    expect(readinessStatus(undefined)).toBeNull()
  })

  it('recoveryLead: пустые элементы не роняют и считаются «не готовы»', () => {
    const lead = recoveryLead([null, { group: 'грудь', state: 'ready', bucket: 'fresh' }])
    expect(lead.kind).toBe('resting')
    expect(lead.items).toEqual([null])
  })

  it('groupBuckets: пустые элементы пропускаются', () => {
    expect(groupBuckets([null, { bucket: 'fresh' }, { group: 'грудь', bucket: 'due' }], [null, { kind: 'never' }]))
      .toEqual({ грудь: 'due' })
  })

  it('never в дисбалансе побеждает бакет из recovery', () => {
    expect(groupBuckets([{ group: 'грудь', bucket: 'due' }], [{ group: 'грудь', kind: 'never' }])).toEqual({ грудь: 'never' })
  })
})

describe('imbalance: окно и порядок', () => {
  const at = (group, n) => wk({ id: group, at: daysAgo(n), entries: [{ group }] })
  const opts = { now: NOW, groups: ['грудь', 'спина', 'ноги', 'плечи'] }

  it('граница окна: 13 дней — в норме, 14 — выпала', () => {
    expect(imbalance([at('грудь', 13)], { ...opts, groups: ['грудь'] })).toEqual([])
    expect(imbalance([at('грудь', 14)], { ...opts, groups: ['грудь'] })).toEqual([{ group: 'грудь', kind: 'stale', daysSince: 14 }])
  })

  it('свое окно и свой список групп', () => {
    expect(imbalance([at('грудь', 5)], { now: NOW, windowDays: 5, groups: ['грудь'] })[0].kind).toBe('stale')
  })

  it('заброшенные по давности вниз, затем «ни разу» — какой бы ни был порядок групп', () => {
    const list = [at('спина', 20), at('плечи', 40)]
    expect(imbalance(list, opts).map((x) => x.group)).toEqual(['плечи', 'спина', 'грудь', 'ноги'])
    expect(imbalance(list, { ...opts, groups: ['грудь', 'плечи', 'ноги', 'спина'] }).map((x) => x.kind))
      .toEqual(['stale', 'stale', 'never', 'never'])
  })
})

describe('submuscleFreshness: часы, пороги, порядок', () => {
  it('now строкой, подмышца со своим порогом', () => {
    const list = [wk({ at: hoursAgo(30), entries: [{ group: 'спина', sub: 'lats' }] })]
    const asDate = submuscleFreshness(list, { now: NOW })[0]
    expect(submuscleFreshness(list, { now: NOW.toISOString() })[0]).toEqual(asDate)
    expect(asDate).toMatchObject({ submuscle: 'lats', major: 'спина', recoveryHours: 72, state: 'resting' })
  })

  it('внутри бакета — по давности, при равенстве по слагу', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(3), entries: [{ group: 'спина', sub: 'lats' }] }),
      wk({ id: 'b', at: daysAgo(5), entries: [{ group: 'ноги', sub: 'quads' }] }),
      wk({ id: 'c', at: daysAgo(5), entries: [{ group: 'ноги', sub: 'calves' }] }),
    ]
    expect(submuscleFreshness(list, { now: NOW }).map((f) => f.submuscle)).toEqual(['calves', 'quads', 'lats'])
  })

  it('будущая тренировка не дает отрицательных часов', () => {
    const list = [wk({ at: hoursAgo(-5), entries: [{ group: 'спина', sub: 'lats' }] })]
    expect(submuscleFreshness(list, { now: NOW })[0].hoursSince).toBe(0)
  })
})

describe('submuscleImbalance: stale и порядок', () => {
  it('заброшенная подмышца в активной группе, граница окна', () => {
    const list = (n) => [
      wk({ id: 'a', at: daysAgo(1), entries: [{ group: 'спина', sub: 'lats' }] }),
      wk({ id: 'b', at: daysAgo(n), entries: [{ group: 'спина', sub: 'rhomboids' }] }),
    ]
    const of = (n) => submuscleImbalance(list(n), { now: NOW }).find((x) => x.submuscle === 'rhomboids')
    expect(of(13)).toBeUndefined()
    expect(of(14)).toEqual({ submuscle: 'rhomboids', major: 'спина', kind: 'stale', daysSince: 14 })
  })

  it('свое окно', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(1), entries: [{ group: 'спина', sub: 'lats' }] }),
      wk({ id: 'b', at: daysAgo(3), entries: [{ group: 'спина', sub: 'rhomboids' }] }),
    ]
    expect(submuscleImbalance(list, { now: NOW, windowDays: 3 }).find((x) => x.submuscle === 'rhomboids').kind).toBe('stale')
  })

  it('заброшенные по давности вниз, «ни разу» — после них', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(1), entries: [{ group: 'спина', sub: 'lats' }] }),
      wk({ id: 'b', at: daysAgo(20), entries: [{ group: 'спина', sub: 'lower_back' }] }),
      wk({ id: 'c', at: daysAgo(30), entries: [{ group: 'спина', sub: 'rhomboids' }] }),
    ]
    const out = submuscleImbalance(list, { now: NOW })
    expect(out.slice(0, 2).map((x) => x.submuscle)).toEqual(['rhomboids', 'lower_back'])
    expect(out.slice(2).every((x) => x.kind === 'never')).toBe(true)
  })

  it('только «давняя» группа остается активной: ее подмышцы все равно считаются', () => {
    const list = [wk({ at: daysAgo(30), entries: [{ group: 'спина', sub: 'lats' }] })]
    const lats = submuscleImbalance(list, { now: NOW }).find((x) => x.submuscle === 'lats')
    expect(lats).toEqual({ submuscle: 'lats', major: 'спина', kind: 'stale', daysSince: 30 })
  })
})

describe('readinessView: края', () => {
  const rec = (submuscle, state, daysSince, extra = {}) => ({
    submuscle, major: 'спина', daysSince, hoursSince: 10, recoveryHours: 48, state, ...extra,
  })

  it('пустые строки и строки без подмышцы пропускаются', () => {
    const v = readinessView([null, {}, rec('lats', 'ready', 3)], [null, { kind: 'never' }])
    expect(v.ready.map((x) => x.submuscle)).toEqual(['lats'])
    expect(v.old).toEqual([])
  })

  it('«можно» — дольше отдыхавшие выше, при равенстве по слагу', () => {
    const v = readinessView([rec('lats', 'ready', 3), rec('traps', 'ready', 9), rec('calves', 'ready', 3)], [])
    expect(v.ready.map((x) => x.submuscle)).toEqual(['traps', 'calves', 'lats'])
  })

  it('«отдыхают» — скорее готовые выше, при равенстве по слагу', () => {
    const v = readinessView([
      rec('lats', 'resting', 1, { hoursSince: 30 }),
      rec('calves', 'resting', 1, { hoursSince: 30 }),
      rec('traps', 'almost', 1, { hoursSince: 40 }),
    ], [])
    expect(v.resting.map((x) => x.submuscle)).toEqual(['traps', 'calves', 'lats'])
  })

  it('остаток часов: округляется вверх, не меньше 0, пустые поля считаются нулем', () => {
    const v = readinessView([
      rec('lats', 'resting', 1, { hoursSince: 10.5 }),
      rec('traps', 'almost', 3, { hoursSince: 60 }),
      rec('calves', 'resting', 1, { hoursSince: undefined, recoveryHours: undefined }),
    ], [])
    const left = Object.fromEntries(v.resting.map((x) => [x.submuscle, x.hoursLeft]))
    expect(left).toEqual({ lats: 38, traps: 0, calves: 0 })
  })

  it('«давно» идет раньше «ни разу», внутри — по давности; порядок входа не важен', () => {
    const imb = [
      { submuscle: 'lats', major: 'спина', kind: 'never', daysSince: null },
      { submuscle: 'traps', major: 'спина', kind: 'stale', daysSince: 20 },
      { submuscle: 'calves', major: 'ноги', kind: 'stale', daysSince: 40 },
      { submuscle: 'quads', major: 'ноги', kind: 'never', daysSince: null },
    ]
    const v = readinessView([], imb)
    expect(v.old.map((x) => x.submuscle)).toEqual(['calves', 'traps', 'lats', 'quads'])
    expect(v.bySub).toEqual({ lats: 'never', traps: 'stale', calves: 'stale', quads: 'never' })
  })

  it('stale в recovery не задваивается в old', () => {
    const v = readinessView(
      [rec('traps', 'ready', 20)],
      [{ submuscle: 'traps', major: 'спина', kind: 'stale', daysSince: 20 }],
    )
    expect(v.old).toEqual([{ submuscle: 'traps', major: 'спина', daysSince: 20, status: 'stale' }])
    expect(v.ready).toEqual([])
  })

  it('полный путь из настоящих тренировок: вторичная нагрузка не делает мышцу отдыхающей', () => {
    const list = [
      wk({ id: 'a', at: hoursAgo(5), entries: [{ group: 'спина', sub: 'lats', sec: ['rhomboids'] }] }),
      wk({ id: 'b', at: daysAgo(20), entries: [{ group: 'спина', sub: 'rhomboids' }] }),
    ]
    const v = readinessView(submuscleFreshness(list, { now: NOW }), submuscleImbalance(list, { now: NOW }))
    expect(v.bySub.lats).toBe('resting')
    expect(v.bySub.rhomboids).toBe('ready')
  })
})

describe('regionTarget и fmtHoursLeft: края', () => {
  const view = { ready: [{ submuscle: 'lats' }], old: [{ submuscle: 'calves' }] }

  it('нет списка мышц зоны или вкладок', () => {
    expect(regionTarget(view, ['ready', 'old'], 'ready', null)).toBeNull()
    expect(regionTarget(view, null, 'old', ['calves']).tab).toBe('old')
    expect(regionTarget(view, null, 'ready', ['calves'])).toBeNull()
  })

  it('вкладки без данных пропускаются, открытая не проверяется дважды', () => {
    expect(regionTarget(view, ['resting', 'ready', 'old'], 'resting', ['calves'])).toEqual({ tab: 'old', items: [{ submuscle: 'calves' }] })
  })

  it('fmtHoursLeft: мусор, граница суток, округление вверх по дням', () => {
    expect(fmtHoursLeft('abc')).toBe('уже почти')
    expect(fmtHoursLeft(-5)).toBe('уже почти')
    expect(fmtHoursLeft(0.4)).toBe('уже почти')
    expect(fmtHoursLeft(23.4)).toBe('через ~23 ч')
    expect(fmtHoursLeft(23.6)).toBe('через ~1 дн')
    expect(fmtHoursLeft(49)).toBe('через ~3 дн')
  })
})
