// Журналы устройства в обращении (23.10.2026, fb_39b706ad): строки обоих журналов по очереди, пока context
// влезает в предел сервера (octet_length(jsonb::text) ≤ 4000), текст для Админки и Telegram.
import { describe, expect, it } from 'vitest'
import { jsonbBytes, logsText, pushLogLine, withDeviceLogs, CONTEXT_MAX_BYTES } from './deviceLogs.js'

const swipe = (i) => ({ at: '2026-10-23T12:24:00Z', kind: 'back', p: 0.17, v: 0.01, flick: 0.03, moves: 14 + i, ms: 400, lag: 1 })
const push = (i) => ({ at: Date.parse('2026-10-23T12:20:00Z') + i * 1000, who: i % 2 ? 'sw' : 'app', ev: 'click', detail: `/#feed-${i}` })
const ctx = { version: '1.4.1', device: 'iPhone · iOS 27.0', standalone: true, screen: 'Профиль' }

describe('deviceLogs', () => {
  it('jsonbBytes считает как Postgres: пробелы после «,» и «:», UTF-8', () => {
    expect(jsonbBytes({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}'.length)
    expect(jsonbBytes({ s: 'ж' })).toBe('{"s": "ж"}'.length + 1)
  })

  it('пустые журналы — context без logs', () => {
    expect(withDeviceLogs(ctx, {})).toBe(ctx)
    expect(withDeviceLogs(ctx, { swipes: [], pushes: [] })).toBe(ctx)
  })

  it('свайпы свежие сверху как есть, пуши — переворачиваются (readPushLog отдает старые сверху)', () => {
    const out = withDeviceLogs(ctx, { swipes: [swipe(0), swipe(1)], pushes: [push(0), push(1)] })
    expect(out.logs.swipe[0]).toMatch(/14 точек/)
    expect(out.logs.push[0]).toMatch(/sw click · \/#feed-1$/)
    expect(out).toMatchObject(ctx)
  })

  it('полные журналы (30 + 40) режутся под предел, оба журнала представлены', () => {
    const out = withDeviceLogs(ctx, {
      swipes: Array.from({ length: 30 }, (_, i) => swipe(i)),
      pushes: Array.from({ length: 40 }, (_, i) => push(i)),
    })
    expect(jsonbBytes(out)).toBeLessThanOrEqual(CONTEXT_MAX_BYTES)
    expect(out.logs.swipe.length).toBeGreaterThan(5)
    expect(out.logs.push.length).toBeGreaterThan(5)
  })

  it('длинная строка обрезается, и даже маленький предел не ломает context', () => {
    const out = withDeviceLogs(ctx, { pushes: [{ at: 0, who: 'app', ev: 'x', detail: 'я'.repeat(500) }] })
    expect(out.logs.push[0].length).toBeLessThanOrEqual(200)
    expect(withDeviceLogs(ctx, { swipes: [swipe(0)] }, 50)).toBe(ctx)
  })

  it('pushLogLine: время, кто, событие, подробность; битое время — прочерк', () => {
    expect(pushLogLine({ at: 'нет', who: 'sw', ev: 'push' })).toBe('— sw push')
  })

  it('logsText: заголовки и строки; мусор и пустое — null', () => {
    expect(logsText({ swipe: ['a', 'b'], push: ['c'] })).toBe('Свайпы «назад» (2, свежие сверху):\na\nb\n\nПуши (1, свежие сверху):\nc')
    expect(logsText({ swipe: [] })).toBeNull()
    expect(logsText('x')).toBeNull()
    expect(logsText(null)).toBeNull()
  })
})
