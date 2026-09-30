// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAccentSync } from './useAccentSync.js'
import { ACCENT_KEY } from '../lib/accent.js'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/repo.js', () => ({ getAccentPref: vi.fn() }))

const mem = (init) => {
  const m = new Map(init ? [[ACCENT_KEY, init]] : [])
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }
}
const stored = (s) => JSON.parse(s.m.get(ACCENT_KEY))

describe('useAccentSync (v6.2.4: только свой выбор)', () => {
  it('своё значение из учётки применяется и запоминается с владельцем', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'peach', hue: 200, by: 'u1' })
    const storage = mem()
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(root.dataset.accent).toBe('peach')
    expect(stored(storage)).toEqual({ id: 'peach', hue: 200, by: 'u1' })
  })

  it('значение без владельца (залито v6.2.0) игнорируется, чужой цвет устройства → вольт', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'pink', hue: 200 })
    const storage = mem('{"id":"teal","hue":200,"by":"u2"}')
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(root.dataset.accent).toBe('volt')
    expect(stored(storage).id).toBe('volt')
    expect(stored(storage).by).toBeUndefined()
  })

  it('значение другой учётки в своей meta не принимается', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'pink', hue: 200, by: 'u2' })
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage: mem(), root }))
    expect(root.dataset.accent).toBe('volt')
  })

  it('в учётке пусто, на устройстве свой выбор — оставляем как есть', () => {
    vi.mocked(useLiveQuery).mockReturnValue(null)
    const storage = mem('{"id":"teal","hue":200,"by":"u1"}')
    const root = document.createElement('div')
    root.dataset.accent = 'teal'
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(root.dataset.accent).toBe('teal')
    expect(stored(storage)).toEqual({ id: 'teal', hue: 200, by: 'u1' })
  })

  it('пока meta не прочитана — ничего не делает', () => {
    vi.mocked(useLiveQuery).mockReturnValue(undefined)
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage: mem('{"id":"teal","by":"u2"}'), root }))
    expect(root.dataset.accent).toBeUndefined()
  })
})
