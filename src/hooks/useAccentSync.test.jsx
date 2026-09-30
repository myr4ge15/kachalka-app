// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { setAccentPref } from '../db/repo.js'
import { useAccentSync } from './useAccentSync.js'
import { ACCENT_KEY } from '../lib/accent.js'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/repo.js', () => ({ getAccentPref: vi.fn(), setAccentPref: vi.fn(() => Promise.resolve()) }))

const mem = (init) => {
  const m = new Map(init ? [[ACCENT_KEY, init]] : [])
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }
}

describe('useAccentSync', () => {
  beforeEach(() => { vi.mocked(setAccentPref).mockClear() })

  it('значение с сервера применяется к <html> и запоминается для сплэша', () => {
    vi.mocked(useLiveQuery).mockReturnValue({ id: 'peach', hue: 200 })
    const storage = mem()
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage, root }))
    expect(root.dataset.accent).toBe('peach')
    expect(JSON.parse(storage.m.get(ACCENT_KEY))).toEqual({ id: 'peach', hue: 200 })
    expect(setAccentPref).not.toHaveBeenCalled()
  })

  it('в meta пусто, на устройстве явный выбор — заливает его наверх', () => {
    vi.mocked(useLiveQuery).mockReturnValue(null)
    renderHook(() => useAccentSync('u1', { storage: mem('{"id":"teal","hue":200}'), root: document.createElement('div') }))
    expect(setAccentPref).toHaveBeenCalledWith('u1', { id: 'teal', hue: 200 })
  })

  it('в meta пусто и выбора не было — дефолт наверх не едет', () => {
    vi.mocked(useLiveQuery).mockReturnValue(null)
    renderHook(() => useAccentSync('u1', { storage: mem(), root: document.createElement('div') }))
    expect(setAccentPref).not.toHaveBeenCalled()
  })

  it('пока meta не прочитана — ничего не делает', () => {
    vi.mocked(useLiveQuery).mockReturnValue(undefined)
    const root = document.createElement('div')
    renderHook(() => useAccentSync('u1', { storage: mem('{"id":"teal"}'), root }))
    expect(root.dataset.accent).toBeUndefined()
    expect(setAccentPref).not.toHaveBeenCalled()
  })
})
