import { describe, it, expect } from 'vitest'
import {
  recoveryHoursFor,
  DEFAULT_RECOVERY_HOURS,
  lastTrainedByGroup,
  freshnessState,
  freshnessBucket,
  groupFreshness,
  mostNeglectedGroup,
  imbalance,
  groupBuckets,
  lastTrainedBySubmuscle,
  lastWorkedBySubmuscle,
  submuscleFreshness,
  submuscleImbalance,
  mostNeglectedSubmuscle,
  submuscleBuckets,
} from './freshness.js'

function wk({ id, at, entries, deleted }) {
  return {
    id,
    user_id: 'me',
    performed_at: at,
    created_at: at,
    _deleted: deleted ? 1 : 0,
    entries: (entries ?? []).map((e) => ({
      exercise_id: e.exId,
      exercise: { id: e.exId, name: e.name ?? e.exId, muscle_group: e.group ?? null },
      sets: e.sets ?? [{ weight: 50, reps: 8 }],
    })),
  }
}
const NOW = new Date('2026-07-10T12:00:00')
const daysAgo = (n) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('recoveryHoursFor', () => {
  it('крупные группы дольше, мелкие быстрее', () => {
    expect(recoveryHoursFor('ноги')).toBe(72)
    expect(recoveryHoursFor('спина')).toBe(72)
    expect(recoveryHoursFor('пресс')).toBe(24)
    expect(recoveryHoursFor('бицепс')).toBe(48)
  })
  it('неизвестная группа → дефолт', () => {
    expect(recoveryHoursFor('предплечья')).toBe(DEFAULT_RECOVERY_HOURS)
    expect(recoveryHoursFor(null)).toBe(DEFAULT_RECOVERY_HOURS)
  })
})

describe('freshnessState', () => {
  it('пороги resting/almost/ready относительно порога группы', () => {
    expect(freshnessState(10, 48)).toBe('resting') // < 0.75*48=36
    expect(freshnessState(40, 48)).toBe('almost') // 36..48
    expect(freshnessState(48, 48)).toBe('ready') // ≥ порога
    expect(freshnessState(100, 48)).toBe('ready')
  })
})

describe('freshnessBucket', () => {
  it('диапазоны давности → бакеты цвета', () => {
    expect(freshnessBucket(0)).toBe('fresh')
    expect(freshnessBucket(2)).toBe('fresh')
    expect(freshnessBucket(3)).toBe('recent')
    expect(freshnessBucket(6)).toBe('recent')
    expect(freshnessBucket(7)).toBe('due')
    expect(freshnessBucket(14)).toBe('due')
    expect(freshnessBucket(15)).toBe('overdue')
    expect(freshnessBucket(90)).toBe('overdue')
  })
})

describe('lastTrainedByGroup', () => {
  it('берёт самую свежую тренировку по каждой группе', () => {
    const list = [
      wk({ id: 'a', at: daysAgo(10), entries: [{ exId: 'bp', group: 'грудь' }] }),
      wk({ id: 'b', at: daysAgo(2), entries: [{ exId: 'bp', group: 'грудь' }] }),
      wk({ id: 'c', at: daysAgo(5), entries: [{ exId: 'sq', group: 'ноги' }] }),
    ]
    const m = lastTrainedByGroup(list)
    expect(m.get('грудь').at).toBe(list[1].performed_at)
    expect(m.get('ноги').at).toBe(list[2].performed_at)
  })
  it('пропускает удалённые и без даты', () => {
    const list = [
      wk({ id: 'd', at: daysAgo(1), entries: [{ exId: 'bp', group: 'грудь' }], deleted: true }),
      wk({ id: 'n', at: null, entries: [{ exId: 'sq', group: 'ноги' }] }),
    ]
    const m = lastTrainedByGroup(list)
    expect(m.size).toBe(0)
  })
})

describe('groupFreshness', () => {
  it('поля и сортировка: пора-тренировать сверху, свежее снизу', () => {
    const list = [
      wk({ id: 'legs', at: daysAgo(15), entries: [{ exId: 'sq', group: 'ноги' }] }),
      wk({ id: 'back', at: daysAgo(8), entries: [{ exId: 'row', group: 'спина' }] }),
      wk({ id: 'chest', at: daysAgo(1), entries: [{ exId: 'bp', group: 'грудь' }] }),
    ]
    const fr = groupFreshness(list, { now: NOW })
    expect(fr.map((f) => f.group)).toEqual(['ноги', 'спина', 'грудь'])
    const legs = fr[0]
    expect(legs.daysSince).toBe(15)
    expect(legs.bucket).toBe('overdue')
    expect(legs.state).toBe('ready') // 15дн >> 72ч
    const chest = fr[2]
    expect(chest.bucket).toBe('fresh')
    expect(chest.state).toBe('resting') // ~24ч < 0.75*48
  })
  it('пустая история → пустой массив', () => {
    expect(groupFreshness([], { now: NOW })).toEqual([])
  })
})

describe('mostNeglectedGroup', () => {
  it('самая просроченная группа', () => {
    const list = [
      wk({ id: 'legs', at: daysAgo(18), entries: [{ exId: 'sq', group: 'ноги' }] }),
      wk({ id: 'chest', at: daysAgo(1), entries: [{ exId: 'bp', group: 'грудь' }] }),
    ]
    const w = mostNeglectedGroup(list, NOW)
    expect(w.group).toBe('ноги')
    expect(w.daysAgo).toBe(18)
  })
  it('нет групп → null', () => {
    expect(mostNeglectedGroup([], NOW)).toBeNull()
  })
})

describe('imbalance', () => {
  it('never (ни разу) и stale (выпала из окна), stale раньше never', () => {
    const list = [
      wk({ id: 'legs', at: daysAgo(20), entries: [{ exId: 'sq', group: 'ноги' }] }),
      wk({ id: 'chest', at: daysAgo(1), entries: [{ exId: 'bp', group: 'грудь' }] }),
    ]
    const im = imbalance(list, { now: NOW, windowDays: 14 })
    // грудь свежая → не в списке; ноги stale; спина/плечи/бицепс/трицепс/пресс — never
    const legs = im.find((x) => x.group === 'ноги')
    expect(legs).toEqual({ group: 'ноги', kind: 'stale', daysSince: 20 })
    expect(im.find((x) => x.group === 'грудь')).toBeUndefined()
    expect(im[0].kind).toBe('stale') // stale раньше never
    expect(im.some((x) => x.group === 'спина' && x.kind === 'never')).toBe(true)
  })
  it('всё свежее → пустой дисбаланс', () => {
    const all = ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс']
    const list = all.map((g, i) => wk({ id: `w${i}`, at: daysAgo(1), entries: [{ exId: g, group: g }] }))
    expect(imbalance(list, { now: NOW, windowDays: 14 })).toEqual([])
  })
})

describe('groupBuckets', () => {
  it('тренированные — бакет из recovery, never из дисбаланса', () => {
    const recovery = [
      { group: 'ноги', bucket: 'overdue' },
      { group: 'грудь', bucket: 'fresh' },
    ]
    const imb = [
      { group: 'спина', kind: 'never', daysSince: null },
      { group: 'плечи', kind: 'stale', daysSince: 20 },
    ]
    const m = groupBuckets(recovery, imb)
    expect(m).toEqual({ ноги: 'overdue', грудь: 'fresh', спина: 'never' })
    // stale в карту не идёт (спина уже покрыта recovery/never; stale — только текст дисбаланса)
    expect(m['плечи']).toBeUndefined()
  })
  it('пустые входы → пустая карта', () => {
    expect(groupBuckets([], [])).toEqual({})
    expect(groupBuckets(undefined, undefined)).toEqual({})
  })
})

// ─────────────────────────── Уровень подмышц (слайс 3a) ─────────────────────
function swk({ id, at, entries, deleted }) {
  return {
    id,
    user_id: 'me',
    performed_at: at,
    created_at: at,
    _deleted: deleted ? 1 : 0,
    entries: (entries ?? []).map((e) => ({
      exercise_id: e.sub,
      exercise: {
        id: e.sub,
        name: e.sub,
        muscle_group: e.major ?? null,
        submuscle: e.sub ?? null,
        secondary: e.sec ?? [],
      },
      sets: [{ weight: 50, reps: 8 }],
    })),
  }
}

describe('lastTrainedBySubmuscle / lastWorkedBySubmuscle', () => {
  it('primary попадает в trained; secondary — только в worked', () => {
    const w = [swk({ id: 'a', at: daysAgo(1), entries: [{ sub: 'chest_lower', major: 'грудь', sec: ['triceps', 'delt_front'] }] })]
    const trained = lastTrainedBySubmuscle(w)
    const worked = lastWorkedBySubmuscle(w)
    expect([...trained.keys()]).toEqual(['chest_lower'])
    expect(new Set(worked.keys())).toEqual(new Set(['chest_lower', 'triceps', 'delt_front']))
  })
})

describe('submuscleFreshness', () => {
  const w = [
    swk({ id: 'q', at: daysAgo(5), entries: [{ sub: 'quads', major: 'ноги' }] }),
    swk({ id: 'c', at: daysAgo(1), entries: [{ sub: 'chest_lower', major: 'грудь' }] }),
    swk({ id: 'card', at: daysAgo(0), entries: [{ sub: 'cardio', major: 'кардио' }] }),
  ]
  const out = submuscleFreshness(w, { now: NOW })

  it('кардио исключено; по строке на тренированную подмышцу', () => {
    expect(out.map((f) => f.submuscle)).toEqual(['quads', 'chest_lower'])
  })
  it('сортировка «пора» вниз (recent прежде fresh) + major и пороги', () => {
    expect(out[0].submuscle).toBe('quads')
    expect(out[0].major).toBe('ноги')
    expect(out[0].bucket).toBe('recent')
    expect(out[0].recoveryHours).toBe(72)
    expect(out[0].state).toBe('ready') // 120ч ≥ 72ч
    expect(out[1].bucket).toBe('fresh')
  })
})

describe('submuscleImbalance', () => {
  const w = [
    swk({ id: 'd', at: daysAgo(2), entries: [{ sub: 'delt_front', major: 'плечи' }] }),
    swk({ id: 'b', at: daysAgo(1), entries: [{ sub: 'lats', major: 'спина', sec: ['rhomboids'] }] }),
  ]
  const imb = submuscleImbalance(w, { now: NOW })
  const subs = new Set(imb.map((x) => x.submuscle))

  it('never — только в активных группах, где подмышца не работала', () => {
    expect(subs.has('delt_side')).toBe(true) // плечи активны, средняя дельта ни разу
    expect(subs.has('delt_rear')).toBe(true)
    expect(subs.has('lower_back')).toBe(true) // спина активна, разгибатели ни разу
  })
  it('вторичная работа спасает от «ни разу» (rhomboids)', () => {
    expect(subs.has('rhomboids')).toBe(false)
  })
  it('подмышцы неактивных групп не упоминаются', () => {
    expect(subs.has('biceps')).toBe(false)
    expect(subs.has('quads')).toBe(false)
  })
})

describe('mostNeglectedSubmuscle', () => {
  it('самая давняя по основной работе', () => {
    const w = [
      swk({ id: 'q', at: daysAgo(9), entries: [{ sub: 'quads', major: 'ноги' }] }),
      swk({ id: 'c', at: daysAgo(2), entries: [{ sub: 'chest_lower', major: 'грудь' }] }),
    ]
    expect(mostNeglectedSubmuscle(w, NOW)).toEqual({ submuscle: 'quads', major: 'ноги', daysAgo: 9 })
  })
  it('пусто → null', () => {
    expect(mostNeglectedSubmuscle([], NOW)).toBeNull()
  })
})

describe('submuscleBuckets', () => {
  it('тренированные берут бакет, never — из дисбаланса, пустые не идут', () => {
    const rec = [{ submuscle: 'quads', bucket: 'recent' }, { submuscle: 'chest_lower', bucket: 'fresh' }]
    const imb = [{ submuscle: 'delt_rear', kind: 'never' }, { submuscle: 'lats', kind: 'stale', daysSince: 20 }]
    const m = submuscleBuckets(rec, imb)
    expect(m).toEqual({ quads: 'recent', chest_lower: 'fresh', delt_rear: 'never' })
    expect(m.lats).toBeUndefined() // stale в карту не идёт
  })
  it('пустые входы → пустая карта', () => {
    expect(submuscleBuckets([], [])).toEqual({})
    expect(submuscleBuckets(undefined, undefined)).toEqual({})
  })
})
