import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_BYTES, readDiagnostics, recordDiagnostic, recordFailure } from './diagnostics.js'
import { withDeviceLogs, jsonbBytes } from '../lib/deviceLogs.js'

describe('диагностика установки', () => {
  it('сворачивает повтор среди других событий, изолирует учётки и сохраняет окрестность ошибки', async () => {
    const owner = 'around'
    const write = (code, at, error = false) => recordDiagnostic(code, { owner, at, error })
    await write('screen.feed', 1)
    await Promise.all([write('sync.failed', 2, true), write('sync.failed', 3, true)])
    await recordDiagnostic('private', { owner: 'other', error: true })
    for (let i = 0; i < 50; i++) await write('after.' + i, i + 4)
    const fragment = await readDiagnostics(owner)
    const ctx = withDeviceLogs({}, { diagnostics: fragment }, 300)
    expect(jsonbBytes(ctx)).toBeLessThanOrEqual(300)
    expect(ctx.logs.diagnostic.join(' ')).toMatch(/after\.0.*sync.failed ×2.*screen.feed/)
    expect(ctx.logs.diagnostic.join(' ')).not.toMatch(/private|after\.49/)
  })

  it('игнорирует произвольный текст и URL ошибки', async () => {
    await recordFailure('runtime.error', { name: 'SECRET', message: 'SECRET', stack: 'Error\n    at https://secret.example/app.js:10:20' }, 'safe')
    const [{ line }] = await readDiagnostics('safe')
    expect(line).toContain('runtime.error.Error.10.20')
    expect(line).not.toMatch(/secret/i)
  })

  it('вытесняет старейшую запись другой учётки при заполнении общего бюджета', async () => {
    const db = await new Dexie('gym_app_diagnostics').open()
    try {
      const padding = { owner: 'old', code: 'old', payload: 'x'.repeat(DIAGNOSTIC_BYTES - 90) }
      await db.transaction('rw', db.table('events'), db.table('meta'), async () => {
        await db.table('events').clear()
        padding.id = await db.table('events').add(padding)
        await db.table('meta').put(new TextEncoder().encode(JSON.stringify(padding)).length, 'bytes')
      })
      await recordDiagnostic('screen.profile', { owner: 'new' })
      expect(await readDiagnostics('old')).toEqual([])
      expect(await readDiagnostics('new')).toHaveLength(1)
      expect(await db.table('meta').get('bytes')).toBeLessThanOrEqual(DIAGNOSTIC_BYTES)
    } finally { db.close() }
  })
})
