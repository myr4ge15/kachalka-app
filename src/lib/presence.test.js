import { describe, expect, it } from 'vitest'
import { isOnline, presenceLabel, wasVerb, ONLINE_MS } from './presence.js'

// Местное время: тесты гоняются и под Москвой, и под Лос-Анджелесом (CI matrix).
const NOW = new Date(2026, 9, 15, 14, 30).getTime()
const ago = (ms) => new Date(NOW - ms).toISOString()
const MIN = 60 * 1000

describe('presence', () => {
  it('в сети — отметка моложе 5 минут', () => {
    expect(isOnline(ago(4 * MIN), NOW)).toBe(true)
    expect(isOnline(ago(ONLINE_MS), NOW)).toBe(false)
    expect(isOnline(null, NOW)).toBe(false)
    expect(isOnline('мусор', NOW)).toBe(false)
    expect(presenceLabel(ago(30 * 1000), { now: NOW })).toBe('в сети')
  })

  it('глагол по полу', () => {
    expect(wasVerb('m')).toBe('был')
    expect(wasVerb('f')).toBe('была')
    expect(wasVerb(null)).toBe('был(а)')
  })

  it('минуты, сегодня, вчера, дата, прошлый год', () => {
    expect(presenceLabel(ago(12 * MIN), { sex: 'f', now: NOW })).toBe('была 12 мин назад')
    expect(presenceLabel(new Date(2026, 9, 15, 9, 5).toISOString(), { sex: 'm', now: NOW })).toBe('был сегодня в 09:05')
    expect(presenceLabel(new Date(2026, 9, 14, 23, 50).toISOString(), { now: NOW })).toBe('был(а) вчера в 23:50')
    expect(presenceLabel(new Date(2026, 9, 3, 18, 0).toISOString(), { sex: 'm', now: NOW })).toBe('был 3 окт')
    expect(presenceLabel(new Date(2025, 11, 31, 18, 0).toISOString(), { sex: 'f', now: NOW })).toBe('была 31 дек 2025')
  })

  it('нет отметки — промолчать', () => {
    expect(presenceLabel(null, { now: NOW })).toBeNull()
    expect(presenceLabel('мусор', { now: NOW })).toBeNull()
  })
})
