import { describe, expect, it } from 'vitest'
import {
  adjustRest, clampRestSec, fmtRest, parseRestRun, parseRestSettings, rememberRestDuration,
  restAriaLabel, restDurationFor, restPhase, restPushText, startRest,
  REST_BY_EX_LIMIT, REST_DEFAULT_SEC, REST_MAX_SEC, REST_MIN_SEC, REST_OVER_LIMIT_MS,
} from './restTimer.js'

const T = 1_800_000_000_000

describe('restTimer: фазы от абсолютного endsAt', () => {
  it('идет → остаток и доля, кончился → перебор, брошен → idle', () => {
    const run = startRest({ durSec: 90, now: T, exerciseId: 7, exerciseName: 'Жим' })
    expect(run).toEqual({ endsAt: T + 90_000, durMs: 90_000, exerciseId: '7', exerciseName: 'Жим' })
    expect(restPhase(run, T + 30_000)).toMatchObject({ phase: 'run', leftMs: 60_000 })
    expect(restPhase(run, T + 45_000).progress).toBeCloseTo(0.5)
    expect(restPhase(run, T + 95_000)).toMatchObject({ phase: 'done', overMs: 5_000, progress: 1 })
    expect(restPhase(run, T + 90_000 + REST_OVER_LIMIT_MS + 1).phase).toBe('idle')
    expect(restPhase(null, T).phase).toBe('idle')
  })

  it('сворачивание не сбивает отсчет: фаза зависит только от now', () => {
    const run = startRest({ durSec: 60, now: T })
    // «Заморозка» на 50 с без единого тика — после возврата сразу верный остаток.
    expect(restPhase(run, T + 50_000).leftMs).toBe(10_000)
  })

  it('±15 с двигают конец и длительность; минус на хвосте заканчивает сейчас', () => {
    const run = startRest({ durSec: 60, now: T })
    const plus = adjustRest(run, 15, T + 10_000)
    expect(plus.endsAt).toBe(T + 75_000)
    expect(plus.durMs).toBe(75_000)
    const minus = adjustRest(run, -15, T + 50_000)
    expect(minus.endsAt).toBe(T + 50_000)
    expect(restPhase(minus, T + 50_000).phase).toBe('done')
    expect(adjustRest(startRest({ durSec: 15, now: T }), -15, T).durMs).toBe(REST_MIN_SEC * 1000)
  })
})

describe('restTimer: длительности и настройки', () => {
  it('clamp и дефолт', () => {
    expect(clampRestSec(5)).toBe(REST_MIN_SEC)
    expect(clampRestSec(9999)).toBe(REST_MAX_SEC)
    expect(clampRestSec('abc')).toBe(REST_DEFAULT_SEC)
  })

  it('настройки: мусор → дефолты, кривые поля отбрасываются', () => {
    expect(parseRestSettings('{bad')).toMatchObject({ on: true, sound: 'mix', push: true, defaultSec: 90 })
    const s = parseRestSettings({ on: false, sound: 'boom', defaultSec: 5, byEx: { a: 200, b: 'x' }, extra: 1 })
    expect(s).toEqual({ on: false, sound: 'mix', vibrate: true, wake: true, push: true, defaultSec: REST_MIN_SEC, byEx: { a: 200 } })
  })

  it('длительность упражнения: своя или общая; выбор запоминается', () => {
    let s = parseRestSettings(null)
    expect(restDurationFor(s, 'bench')).toBe(90)
    s = rememberRestDuration(s, 'bench', 180)
    expect(restDurationFor(s, 'bench')).toBe(180)
    expect(restDurationFor(s, 'curl')).toBe(180) // общий по умолчанию — последний выбор
    s = rememberRestDuration(s, 'curl', 60)
    expect(restDurationFor(s, 'bench')).toBe(180)
    expect(restDurationFor(s, 'curl')).toBe(60)
  })

  it('память по упражнениям ограничена, старые вытесняются', () => {
    let s = parseRestSettings(null)
    for (let i = 0; i < REST_BY_EX_LIMIT + 3; i++) s = rememberRestDuration(s, `e${i}`, 60)
    expect(Object.keys(s.byEx)).toHaveLength(REST_BY_EX_LIMIT)
    expect(s.byEx.e0).toBeUndefined()
    expect(s.byEx[`e${REST_BY_EX_LIMIT + 2}`]).toBe(60)
  })
})

describe('restTimer: хранение и тексты', () => {
  it('запуск из хранилища: валидный, брошенный, из «будущего»', () => {
    const run = startRest({ durSec: 90, now: T })
    expect(parseRestRun(JSON.stringify(run), T + 10_000)).toEqual(run)
    expect(parseRestRun(JSON.stringify(run), T + 90_000 + REST_OVER_LIMIT_MS + 1)).toBeNull()
    expect(parseRestRun({ ...run, endsAt: T + 3_600_000 }, T)).toBeNull()
    expect(parseRestRun('{', T)).toBeNull()
    expect(parseRestRun({ endsAt: 'x', durMs: 1 }, T)).toBeNull()
  })

  it('формат: остаток вверх, перебор вниз', () => {
    expect(fmtRest(89_001, { up: true })).toBe('1:30')
    expect(fmtRest(89_999)).toBe('1:29')
    expect(fmtRest(5_000)).toBe('0:05')
    expect(fmtRest(-1)).toBe('0:00')
  })

  it('подписи и текст пуша', () => {
    expect(restAriaLabel({ phase: 'idle' }, 90)).toMatch(/1:30\. Начать/)
    expect(restAriaLabel({ phase: 'run', leftMs: 61_000 }, 90)).toMatch(/осталось 1:01/)
    expect(restAriaLabel({ phase: 'done', overMs: 12_000 }, 90)).toMatch(/0:12 назад/)
    expect(restPushText('Жим лежа')).toEqual({ title: 'Отдых закончился', body: 'Жим лежа — пора к следующему подходу' })
    expect(restPushText(null).body).toBe('Пора к следующему подходу')
  })
})
