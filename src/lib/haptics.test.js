import { describe, it, expect } from 'vitest'
import { shouldVibrate, HAPTIC } from './haptics.js'

describe('shouldVibrate', () => {
  it('есть API и без reduced-motion → вибрируем', () => {
    expect(shouldVibrate({ hasVibrate: true, reducedMotion: false })).toBe(true)
  })

  it('нет API → не вибрируем (iOS/десктоп без vibrate)', () => {
    expect(shouldVibrate({ hasVibrate: false, reducedMotion: false })).toBe(false)
  })

  it('reduced-motion уважается даже при наличии API', () => {
    expect(shouldVibrate({ hasVibrate: true, reducedMotion: true })).toBe(false)
  })

  it('нет API и reduced-motion → не вибрируем', () => {
    expect(shouldVibrate({ hasVibrate: false, reducedMotion: true })).toBe(false)
  })

  it('битые/отсутствующие флаги трактуются как false', () => {
    expect(shouldVibrate({})).toBe(false)
    expect(shouldVibrate({ hasVibrate: undefined, reducedMotion: undefined })).toBe(false)
  })
})

describe('HAPTIC словарь', () => {
  it('содержит ожидаемые паттерны', () => {
    expect(HAPTIC.tap).toBe(10)
    expect(HAPTIC.success).toBe(20)
    expect(Array.isArray(HAPTIC.celebrate)).toBe(true)
  })
})
