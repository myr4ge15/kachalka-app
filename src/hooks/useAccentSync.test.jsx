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
  it('свое значение из учетки применяется и запоминается с владельцем', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'peach', hue: 200, by: 'u1' })
    const storage = mem()
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(root.dataset.accent).toBe('peach')
    expect(stored(storage)).toEqual({ id: 'peach', hue: 200, by: 'u1' })
  })

  it('значение без владельца (залито v6.2.0) игнорируется, чужой цвет устройства → акцент по умолчанию', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'pink', hue: 200 })
    const storage = mem('{"id":"teal","hue":200,"by":"u2"}')
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(root.dataset.accent).toBe('violet')
    expect(stored(storage).id).toBe('violet')
    expect(stored(storage).by).toBeUndefined()
  })

  it('значение другой учетки в своей meta не принимается', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'pink', hue: 200, by: 'u2' })
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage: mem(), root }))
    expect(root.dataset.accent).toBe('violet')
  })

  it('в учетке пусто, на устройстве свой выбор — оставляем как есть', () => {
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

  // Инцидент 30.09: тот же цвет у двух учеток телефона — владелец на устройстве все равно должен стать своим.
  it('тот же цвет, но на устройстве записан другой владелец — перезаписываем со своим', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'peach', hue: 200, by: 'u1' })
    const storage = mem('{"id":"peach","hue":200,"by":"u2"}')
    const root = document.createElement('div')
    root.dataset.accent = 'peach'
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(stored(storage).by).toBe('u1')
  })

  it('все уже совпадает — хранилище не трогаем', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'peach', hue: 200, by: 'u1' })
    const storage = mem('{"id":"peach","hue":200,"by":"u1"}')
    const setItem = vi.spyOn(storage, 'setItem')
    const root = document.createElement('div')
    root.dataset.accent = 'peach'
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(setItem).not.toHaveBeenCalled()
  })

  it('без явного хранилища — localStorage; хранилище недоступно (Safari) — интерфейс не падает', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'peach', hue: 200, by: 'u1' })
    const root = document.createElement('div')
    localStorage.clear()
    renderHook(() => useAccentSync('u1', { root }))
    expect(JSON.parse(localStorage.getItem(ACCENT_KEY))).toMatchObject({ id: 'peach', by: 'u1' })
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('SecurityError') })
    try {
      const root2 = document.createElement('div')
      expect(() => renderHook(() => useAccentSync('u1', { root: root2 }))).not.toThrow()
      expect(root2.dataset.accent).toBe('peach')
    } finally {
      spy.mockRestore()
    }
  })
})
