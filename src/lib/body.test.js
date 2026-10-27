import { describe, expect, it } from 'vitest'
import {
  normalizeBody, normalizeEntry, putEntry, deleteEntry, setBodyPrefs, clearBody, mergeBody, compactBody,
  weightDays, trendSeries, trendChange, trendPace, toneFor, goalLeft, goalForecast, bodyWeightOn,
  lastMeasures, lastEntry, hasEntries, parseWeight, parseCm, fmtSigned, fmtBodyDate, bodyRowSubtitle,
  shiftYmd, KEEP_ALL_DAYS, TOMBSTONE_DAYS, goalTargetProblem, keepTarget,
} from './body.js'

const T = (d, h = 7) => `${d}T0${h}:00:00.000Z`
const e = (id, date, weight, extra = {}) => ({ id, date, weight, at: T(date), ...extra })
const doc = (entries, extra = {}) => normalizeBody({ entries, ...extra })

describe('ввод и нормализация', () => {
  it('вес: 20..350, шаг 0.1, запятая', () => {
    expect(parseWeight('82,34')).toBe(82.3)
    expect(parseWeight(19.9)).toBeNull()
    expect(parseWeight(351)).toBeNull()
    expect(parseWeight('')).toBeNull()
    expect(parseCm('')).toBeNull()
    expect(parseCm('84,5')).toBe(84.5)
  })

  it('запись без веса и без обхватов — мусор; только обхват — можно', () => {
    expect(normalizeEntry({ id: 'a', date: '2026-10-27' })).toBeNull()
    expect(normalizeEntry({ id: 'a', date: '2026-10-27', waist: 84 })).toMatchObject({ waist: 84 })
    expect(normalizeEntry({ id: 'a', date: '27.10.2026', weight: 80 })).toBeNull()
  })

  it('мусор в документе не роняет: пустой документ', () => {
    expect(normalizeBody('x')).toMatchObject({ entries: [], goal: null, fields: [], hide: false })
    expect(normalizeBody({ fields: ['waist', 'nose'], goal: { kind: 'lose', target: 70 } }))
      .toMatchObject({ fields: ['waist'], goal: null })
  })

  it('записи — свежие сверху, несколько в день можно', () => {
    let b = putEntry(null, { id: '1', date: '2026-10-25', weight: 82.5 }, T('2026-10-25'))
    b = putEntry(b, { id: '2', date: '2026-10-27', weight: 82.3 }, T('2026-10-27'))
    b = putEntry(b, { id: '3', date: '2026-10-27', weight: 82.9 }, T('2026-10-27', 9))
    expect(b.entries.map((x) => x.id)).toEqual(['3', '2', '1'])
    expect(weightDays(b).at(-1)).toEqual({ date: '2026-10-27', weight: 82.6 })
  })

  it('невалидная запись — документ тот же (updateSyncedMeta ничего не пишет)', () => {
    const b = doc([e('1', '2026-10-27', 80)])
    expect(putEntry(b, { id: 'x', date: '2026-10-27' })).toBe(b)
    expect(deleteEntry(b, 'нет')).toBe(b)
  })
})

describe('слияние двух устройств', () => {
  it('офлайн-записи с двух телефонов объединяются по id', () => {
    const phone = doc([e('a', '2026-10-26', 82.6)])
    const laptop = doc([e('b', '2026-10-27', 82.3)])
    const m = mergeBody(phone, laptop, true, '2026-10-27')
    expect(m.entries.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(mergeBody(laptop, phone, true, '2026-10-27').entries).toEqual(m.entries)
  })

  it('правка одной записи — побеждает более поздняя', () => {
    const a = doc([e('a', '2026-10-26', 82.6, { at: '2026-10-26T08:00:00Z' })])
    const b = doc([e('a', '2026-10-26', 81.6, { at: '2026-10-26T09:00:00Z' })])
    expect(mergeBody(a, b, true, '2026-10-27').entries[0].weight).toBe(81.6)
    expect(mergeBody(b, a, true, '2026-10-27').entries[0].weight).toBe(81.6)
  })

  it('удаление на одном устройстве не воскресает со второго', () => {
    const base = doc([e('a', '2026-10-26', 82.6)])
    const deleted = deleteEntry(base, 'a', '2026-10-27T10:00:00Z')
    const m = mergeBody(base, deleted, true, '2026-10-27')
    expect(m.entries).toEqual([{ id: 'a', date: '2026-10-26', at: '2026-10-27T10:00:00Z', del: true }])
    expect(hasEntries(m)).toBe(false)
  })

  it('цель и настройки — LWW по отметке документа', () => {
    const a = setBodyPrefs(doc([]), { goal: { kind: 'down', target: 78 } }, '2026-10-27T08:00:00Z')
    const b = setBodyPrefs(doc([]), { hide: true }, '2026-10-27T09:00:00Z')
    const m = mergeBody(a, b, true, '2026-10-27')
    expect(m.hide).toBe(true)
    expect(m.goal).toBeNull()
    expect(mergeBody(a, b, true, '2026-10-27')).toEqual(mergeBody(b, a, false, '2026-10-27'))
  })
})

describe('компактор (лимит 64 КБ)', () => {
  it('год — все записи, старше — одна на неделю, надгробия старше 90 дней — вон', () => {
    const today = '2026-10-27'
    const entries = []
    for (let i = 0; i < 365 * 3; i++) {
      const d = shiftYmd(today, -i)
      entries.push(e(`w${i}`, d, 80 + (i % 7) / 10))
    }
    entries.push({ id: 'oldDel', date: '2026-01-01', at: '2026-05-01T00:00:00Z', del: true })
    entries.push({ id: 'newDel', date: '2026-10-01', at: '2026-10-20T00:00:00Z', del: true })
    const c = compactBody({ entries }, today)
    const recent = c.entries.filter((x) => !x.del && x.date >= shiftYmd(today, -KEEP_ALL_DAYS))
    expect(recent.length).toBe(KEEP_ALL_DAYS + 1)
    const old = c.entries.filter((x) => !x.del && x.date < shiftYmd(today, -KEEP_ALL_DAYS))
    expect(old.length).toBeGreaterThan(100)
    expect(old.length).toBeLessThan(110) // ~ два года по неделе
    expect(c.entries.some((x) => x.id === 'oldDel')).toBe(false)
    expect(c.entries.some((x) => x.id === 'newDel')).toBe(true)
    expect(TOMBSTONE_DAYS).toBe(90)
  })

  it('5 лет ежедневно укладываются в 64 КБ', () => {
    const today = '2026-10-27'
    const entries = []
    for (let i = 0; i < 365 * 5; i++) {
      entries.push({ id: crypto.randomUUID(), date: shiftYmd(today, -i), weight: 82.4, waist: 84, at: '2026-10-27T07:30:00.000Z' })
    }
    const c = compactBody({ entries }, today)
    expect(JSON.stringify(c).length).toBeLessThan(65536)
    // свежие полгода — все до одной
    expect(c.entries.filter((x) => x.date >= shiftYmd(today, -180)).length).toBe(181)
  })

  it('компактор детерминирован: оба устройства получают одно и то же', () => {
    const entries = [e('x', '2024-01-01', 80), e('y', '2024-01-02', 81), e('z', '2024-01-03', 82)]
    const a = compactBody({ entries }, '2026-10-27')
    const b = compactBody({ entries: [...entries].reverse() }, '2026-10-27')
    expect(a.entries).toEqual(b.entries)
    expect(a.entries.map((x) => x.id)).toEqual(['z'])
  })
})

describe('тренд, а не утро', () => {
  const days = []
  for (let i = 0; i <= 40; i++) {
    const d = shiftYmd('2026-09-17', i)
    // 84 → 82 за 40 дней, через день «соленое утро» +1.2
    days.push({ date: d, weight: Math.round((84 - i * 0.05 + (i % 2 ? 1.2 : 0)) * 10) / 10 })
  }
  const trend = trendSeries(days)

  it('соленое утро не дает «+1.2»: тренд гладкий', () => {
    // Первую неделю окно еще набирается — смотрим с восьмого дня.
    const t = trend.slice(7)
    const jumps = t.slice(1).map((p, i) => Math.abs(p.value - t[i].value))
    expect(Math.max(...jumps)).toBeLessThan(0.25)
  })

  it('изменение за 30 дней и темп — по тренду', () => {
    const ch = trendChange(trend)
    expect(ch.days).toBe(30)
    expect(ch.delta).toBeCloseTo(-1.5, 1)
    const pace = trendPace(trend)
    expect(pace).toBeGreaterThanOrEqual(-0.4)
    expect(pace).toBeLessThanOrEqual(-0.3)
  })

  it('короткая история — без выводов', () => {
    expect(trendChange(trend.slice(0, 5))).toBeNull()
    expect(trendPace(trend.slice(0, 5))).toBeNull()
  })
})

describe('toneFor — ни одного «плохого» тона', () => {
  const goals = [null, { kind: 'down', target: 78 }, { kind: 'up', target: 90 }, { kind: 'keep', target: 82 }]
  it('для всех целей и без цели — только good или neutral', () => {
    for (const g of goals) {
      for (const d of [-3, -0.4, 0, 0.4, 3, NaN]) {
        for (const v of [70, 80.6, 82, 83.4, 95, null]) {
          expect(['good', 'neutral']).toContain(toneFor(d, g, v))
        }
      }
    }
  })

  it('без цели все нейтрально; с целью зеленым — только движение к ней', () => {
    expect(toneFor(-2, null)).toBe('neutral')
    expect(toneFor(-2, goals[1])).toBe('good')
    expect(toneFor(2, goals[1])).toBe('neutral')
    expect(toneFor(2, goals[2])).toBe('good')
    expect(toneFor(-2, goals[2])).toBe('neutral')
    expect(toneFor(5, goals[3], 83.4)).toBe('good')
    expect(toneFor(0, goals[3], 84)).toBe('neutral')
  })
})

describe('цель', () => {
  it('сколько до цели и «держать» с коридором', () => {
    expect(goalLeft({ kind: 'down', target: 78 }, 82.4)).toEqual({ left: 4.4, reached: false })
    expect(goalLeft({ kind: 'down', target: 78 }, 77.9)).toEqual({ left: 0, reached: true })
    expect(goalLeft({ kind: 'keep', target: 82 }, 83)).toEqual({ left: 0, reached: true })
    expect(goalLeft(null, 82)).toBeNull()
  })

  it('прогноз — только когда тренд идет к цели', () => {
    expect(goalForecast({ kind: 'down', target: 78 }, 82, -0.5, '2026-10-27')).toBe('2026-12-22')
    expect(goalForecast({ kind: 'down', target: 78 }, 82, 0.3, '2026-10-27')).toBeNull()
    expect(goalForecast({ kind: 'keep', target: 82 }, 82, -0.3, '2026-10-27')).toBeNull()
    expect(goalForecast({ kind: 'up', target: 90 }, 82, 0.01, '2026-10-27')).toBeNull() // дальше года
  })
})

describe('связки и подписи', () => {
  const b = doc([e('1', '2026-09-01', 84), e('2', '2026-10-20', 82.3, { waist: 84 }), e('3', '2026-08-01', 85, { waist: 87 })])

  it('bodyWeightOn — последний вес не позже даты, старше 30 дней — null', () => {
    expect(bodyWeightOn(b, '2026-10-27')).toBe(82.3)
    expect(bodyWeightOn(b, '2026-09-20')).toBe(84)
    expect(bodyWeightOn(b, '2026-10-05')).toBeNull()
    expect(bodyWeightOn(b, '2026-07-01')).toBeNull()
  })

  it('последний замер и изменение за ~2 месяца', () => {
    expect(lastMeasures(b).waist).toMatchObject({ value: 84, date: '2026-10-20', delta: null })
    const b2 = doc([...b.entries, e('4', '2026-09-10', 83, { waist: 86 })])
    expect(lastMeasures(b2).waist).toMatchObject({ value: 84, delta: -2, days: 40 })
  })

  it('подпись в Профиле — дата без веса; без записей — «по желанию»', () => {
    expect(lastEntry(b).id).toBe('2')
    expect(bodyRowSubtitle(b, '2026-10-27')).toBe('последняя запись 20 октября')
    expect(bodyRowSubtitle(b, '2026-10-27')).not.toMatch(/\d+\.\d|кг/)
    expect(bodyRowSubtitle(null)).toMatch(/^по желанию/)
    expect(fmtBodyDate('2025-10-20', '2026-10-27')).toMatch(/2025/)
  })

  it('знак — настоящий минус, ноль без знака', () => {
    expect(fmtSigned(-1.84)).toBe('−1.8')
    expect(fmtSigned(0.4)).toBe('+0.4')
    expect(fmtSigned(0.04)).toBe('0')
  })

  it('«Удалить мои данные»: все записи — надгробия, цель снята, настройки остаются', () => {
    const withGoal = setBodyPrefs(b, { goal: { kind: 'down', target: 78 }, fields: ['waist'] }, '2026-10-27T08:00:00Z')
    const c = clearBody(withGoal, '2026-10-27T09:00:00Z')
    expect(c.entries.every((x) => x.del)).toBe(true)
    expect(c.goal).toBeNull()
    expect(c.fields).toEqual(['waist'])
    expect(clearBody(c)).toBe(c)
  })
})

describe('ввод цели (fb_f87011ab, fb_1993296f)', () => {
  it('«набрать» — только больше текущего, «сбросить» — только меньше', () => {
    expect(goalTargetProblem('up', 65, 70)).toBe('up')
    expect(goalTargetProblem('up', 70, 70)).toBe('up')
    expect(goalTargetProblem('up', 75, 70)).toBeNull()
    expect(goalTargetProblem('down', 75, 70)).toBe('down')
    expect(goalTargetProblem('down', 65, 70)).toBeNull()
    expect(goalTargetProblem('keep', 65, 70)).toBeNull()
    expect(goalTargetProblem('up', 65, null)).toBeNull() // веса еще нет — сравнивать не с чем
  })
  it('«держать» — текущий вес с шагом 0.5', () => {
    expect(keepTarget(70.2)).toBe(70)
    expect(keepTarget(70.3)).toBe(70.5)
    expect(keepTarget(null)).toBeNull()
  })
})
