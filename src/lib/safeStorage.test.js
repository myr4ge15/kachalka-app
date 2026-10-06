// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageGet, storageSet, storageRemove } from './safeStorage.js'

afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear() })

describe('safeStorage', () => {
  it('обычное хранилище — запись, чтение, удаление', () => {
    storageSet('localStorage', 'k', 'v')
    expect(storageGet('localStorage', 'k')).toBe('v')
    storageRemove('localStorage', 'k')
    expect(storageGet('localStorage', 'k')).toBeNull()
  })
  it('хранилище бросает (Safari, частный доступ) — как пустое, без исключений', () => {
    const boom = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } }
    vi.stubGlobal('sessionStorage', boom)
    expect(storageGet('sessionStorage', 'k')).toBeNull()
    expect(() => storageSet('sessionStorage', 'k', 'v')).not.toThrow()
    expect(() => storageRemove('sessionStorage', 'k')).not.toThrow()
  })
})
