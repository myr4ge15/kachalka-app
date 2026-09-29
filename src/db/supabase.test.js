import { describe, it, expect } from 'vitest'
import { isSessionOf, sessionAppUserId } from './supabase.js'

const sessionOf = (appUserId) => ({ user: { app_metadata: appUserId == null ? {} : { app_user_id: appUserId } } })

describe('владелец сессии', () => {
  it('достаёт app_user_id из claim app_metadata', () => {
    expect(sessionAppUserId(sessionOf('u1'))).toBe('u1')
    expect(sessionAppUserId(null)).toBe(null)
  })

  it('сессия своей учётки подходит, чужой — нет', () => {
    expect(isSessionOf(sessionOf('u1'), 'u1')).toBe(true)
    expect(isSessionOf(sessionOf('u2'), 'u1')).toBe(false)
  })

  it('сравнивает id как строки (число из claim vs строка из localStorage)', () => {
    expect(isSessionOf(sessionOf(7), '7')).toBe(true)
  })

  it('без claim сверять не с чем — не блокирует (решает серверный RLS)', () => {
    expect(isSessionOf(sessionOf(null), 'u1')).toBe(true)
  })
})
