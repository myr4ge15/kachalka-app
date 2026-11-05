import { describe, expect, it } from 'vitest'
import { migrationDomain, migrationSummary, MIGRATION_STATES } from './domainMigrationStatus.js'

describe('адрес переезда', () => {
  const location = (hostname, pathname, protocol = 'https:') => ({ hostname, pathname, protocol })
  it('различает два production-адреса, игнорирует бету, локальный и прямую вторую сборку', () => {
    expect(migrationDomain(location('kachalka-app.ru', '/app/'))).toBe('new')
    expect(migrationDomain(location('myr4ge15.github.io', '/kachalka-app/'))).toBe('old')
    for (const loc of [undefined, location('localhost', '/app/'), location('kachalka-app.ru', '/'),
      location('kachalka-app.ru', '/app/', 'http:'), location('myr4ge15.github.io', '/kachalka-app/app/'),
      location('kachalka-beta.pages.dev', '/'), location('evil.example', '/app/')]) {
      expect(migrationDomain(loc)).toBeNull()
    }
    expect(migrationDomain(location('kachalka-app.ru', '/app/'), true)).toBeNull()
  })
})

describe('сводка по известным устройствам', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  const old = { domain: 'old', last_seen_at: '2026-11-04T12:00:00Z', save_state: 'ready', checked_at: '2026-11-04T12:00:00Z' }
  it('нет отметок не означает сохранение или переход', () => {
    expect(migrationSummary([], now)).toMatchObject({ newSeen: false, recentOld: false, oldReady: false, old: [] })
  })
  it('вход на новом не отменяет активность и проблемы на старом', () => {
    expect(migrationSummary([old, { ...old, save_state: 'draft' }, { domain: 'new' }], now))
      .toMatchObject({ newSeen: true, recentOld: true, oldReady: false })
  })
  it('сохранение подтверждается только для всех известных старых устройств с временем проверки', () => {
    expect(migrationSummary([old, { domain: 'new' }], now).oldReady).toBe(true)
    expect(migrationSummary([{ ...old, checked_at: null }], now).oldReady).toBe(false)
    for (const state of Object.keys(MIGRATION_STATES).filter((s) => s !== 'ready')) {
      expect(migrationSummary([{ ...old, save_state: state }], now).oldReady).toBe(false)
    }
    expect(migrationSummary([{ ...old, last_seen_at: '2026-10-01T00:00:00Z' }], now).recentOld).toBe(false)
  })
})
