// @vitest-environment jsdom
// Экран входа: выборка ростера. Регрессия 29.07.2026 — select без `sex` вместе с
// деструктивной записью кэша обнулял пол ВСЕМ учёткам устройства (см. lib/roster.js).
// Здесь пиннится именно место регрессии: какие поля экран спрашивает и что делает,
// если сервер такую выборку не принимает.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LoginScreen from './LoginScreen.jsx'
import { supabase } from '../db/supabase.js'
import { cacheUsers, getUsers } from '../db/repo.js'

// Билдер запоминает строку select и отдаёт заранее заданный результат.
const selects = []
let results = []
vi.mock('../db/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn((fields) => {
        selects.push(fields)
        const res = results.shift() ?? { data: [], error: null }
        const chain = { order: vi.fn(() => chain), then: (fn) => fn(res) }
        return chain
      }),
    })),
  },
}))
vi.mock('../db/repo.js', () => ({ getUsers: vi.fn(() => Promise.resolve([])), cacheUsers: vi.fn() }))
vi.mock('../db/local.js', () => ({ migrateLoginZone: vi.fn(() => Promise.resolve()) }))
vi.mock('../lib/auth.js', () => ({
  login: vi.fn(),
  verifyPinOffline: vi.fn(),
  LoginError: class LoginError extends Error {},
}))

const ROSTER = [{ id: 'u1', name: 'Дима', avatar_url: null, sort_order: 1, sex: 'm' }]

beforeEach(() => {
  selects.length = 0
  results = []
  vi.mocked(supabase.from).mockClear()
  vi.mocked(cacheUsers).mockClear()
  vi.mocked(getUsers).mockResolvedValue([])
})

describe('LoginScreen: выборка ростера', () => {
  it('спрашивает sex и кэширует строки как есть', async () => {
    results = [{ data: ROSTER, error: null }]
    render(<LoginScreen onLogin={() => {}} />)

    await waitFor(() => expect(cacheUsers).toHaveBeenCalledWith(ROSTER))
    expect(selects[0]).toContain('sex')
    expect(await screen.findByText('Дима')).toBeInTheDocument()
  })

  it('если сервер не знает колонку sex — берёт прежний набор полей, а не падает', async () => {
    const legacy = [{ id: 'u1', name: 'Дима', avatar_url: null, sort_order: 1 }]
    results = [
      { data: null, error: { message: 'column login_users.sex does not exist' } },
      { data: legacy, error: null },
    ]
    render(<LoginScreen onLogin={() => {}} />)

    await waitFor(() => expect(cacheUsers).toHaveBeenCalledWith(legacy))
    expect(selects).toHaveLength(2)
    expect(selects[1]).not.toContain('sex')
    expect(await screen.findByText('Дима')).toBeInTheDocument()
    expect(screen.queryByText(/Не удалось загрузить/)).not.toBeInTheDocument()
  })

  it('оба select упали и кэша нет — показывает ошибку, кэш не пишем', async () => {
    results = [
      { data: null, error: { message: 'boom' } },
      { data: null, error: { message: 'boom' } },
    ]
    render(<LoginScreen onLogin={() => {}} />)

    expect(await screen.findByText(/Не удалось загрузить/)).toBeInTheDocument()
    expect(cacheUsers).not.toHaveBeenCalled()
  })
})
