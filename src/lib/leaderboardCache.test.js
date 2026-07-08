import { describe, it, expect } from 'vitest'
import { LEADERBOARD_TTL_MS, shouldRefetchLeaderboard } from './leaderboardCache.js'

describe('shouldRefetchLeaderboard', () => {
  const now = Date.parse('2026-07-08T12:00:00.000Z')

  it('снимка ещё не было → идём на сервер', () => {
    expect(shouldRefetchLeaderboard(null, now)).toBe(true)
    expect(shouldRefetchLeaderboard(undefined, now)).toBe(true)
    expect(shouldRefetchLeaderboard('', now)).toBe(true)
  })

  it('битая метка времени → идём на сервер (не залипаем на кэше)', () => {
    expect(shouldRefetchLeaderboard('не-дата', now)).toBe(true)
  })

  it('снимок свежее TTL → не ходим на сервер', () => {
    const recent = new Date(now - 10 * 1000).toISOString() // 10 c назад
    expect(shouldRefetchLeaderboard(recent, now)).toBe(false)
  })

  it('снимок старше TTL → идём на сервер', () => {
    const stale = new Date(now - LEADERBOARD_TTL_MS - 1).toISOString()
    expect(shouldRefetchLeaderboard(stale, now)).toBe(true)
  })

  it('ровно на границе TTL → идём на сервер', () => {
    const edge = new Date(now - LEADERBOARD_TTL_MS).toISOString()
    expect(shouldRefetchLeaderboard(edge, now)).toBe(true)
  })

  it('кастомный ttl учитывается', () => {
    const at = new Date(now - 5000).toISOString()
    expect(shouldRefetchLeaderboard(at, now, 3000)).toBe(true)
    expect(shouldRefetchLeaderboard(at, now, 10000)).toBe(false)
  })
})
