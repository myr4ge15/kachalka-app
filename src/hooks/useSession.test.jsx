// @vitest-environment jsdom
// Сессия приложения (v6.14.1, вынесена из App.jsx): восстановление, вход, выход,
// SIGNED_OUT. Главное — порядок: персональная база открыта ДО setUser, а при выходе
// экраны снимаются (user=null) ДО закрытия базы.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const order = []
let authListener = null
vi.mock('../db/supabase.js', () => ({
  supabase: { auth: { onAuthStateChange: (cb) => { authListener = cb; return { data: { subscription: { unsubscribe: vi.fn() } } } } } },
}))
vi.mock('../lib/auth.js', () => ({
  logout: vi.fn(async () => { order.push('authLogout') }),
  getCachedProfile: vi.fn(async () => ({ id: 'u1', name: 'Дима', role: 'member' })),
}))
vi.mock('../db/push.js', () => ({
  releasePushOnLogout: vi.fn(async () => { order.push('releasePush') }),
  reconcilePushOwner: vi.fn(),
}))
vi.mock('../db/repo.js', () => ({ getCachedUser: vi.fn(async () => ({ id: 'u1', name: 'Дима' })) }))
vi.mock('../db/local.js', () => ({
  openUserDb: vi.fn(async (id) => { order.push(`open:${id}`) }),
  closeUserDb: vi.fn(() => { order.push('close') }),
}))
vi.mock('../lib/splash.js', () => ({ markAppReady: vi.fn(() => order.push('ready')) }))

import { useSession, SESSION_KEY } from './useSession.js'
import { reconcilePushOwner } from '../db/push.js'

// Записываем в order момент, когда хук отдал user (после рендера).
function track() {
  return renderHook(() => {
    const s = useSession(() => order.push('onLoggedIn'))
    return s
  })
}

beforeEach(() => { order.length = 0; authListener = null; localStorage.clear() })
afterEach(() => vi.clearAllMocks())

describe('useSession', () => {
  it('без сохраненной сессии — сразу «готово», user = null', async () => {
    const { result } = track()
    await waitFor(() => expect(order).toEqual(['ready']))
    expect(result.current.user).toBeNull()
  })

  it('восстановление: база открыта ДО user, в хранилище — только id', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: 'u1', name: 'утекшее', role: 'admin' }))
    const { result } = track()
    await waitFor(() => expect(result.current.user).toMatchObject({ id: 'u1', name: 'Дима' }))
    expect(order).toEqual(['open:u1', 'ready'])
    expect(JSON.parse(localStorage.getItem(SESSION_KEY))).toEqual({ id: 'u1' })
    expect(reconcilePushOwner).toHaveBeenCalledWith('u1')
  })

  it('вход: база → хранилище → user → onLoggedIn', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня', role: 'admin' }))
    expect(order).toEqual(['ready', 'open:u2', 'onLoggedIn'])
    expect(result.current.user).toMatchObject({ id: 'u2' })
    expect(JSON.parse(localStorage.getItem(SESSION_KEY))).toEqual({ id: 'u2' })
  })

  it('выход: пуш → signOut → user=null → закрыть базу; второй вызов — тот же промис', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня' }))
    order.length = 0
    let p1, p2
    await act(async () => { p1 = result.current.handleLogout(); p2 = result.current.handleLogout(); await p1 })
    expect(p1).toBe(p2)
    expect(order).toEqual(['releasePush', 'authLogout', 'close'])
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('SIGNED_OUT от Supabase — на экран входа, база закрыта', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня' }))
    act(() => authListener('SIGNED_OUT'))
    expect(result.current.user).toBeNull()
    expect(order.at(-1)).toBe('close')
  })

  it('переименование меняет только имя; ссылка на функцию стабильна', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня', role: 'admin' }))
    const fn = result.current.handleRenamed
    act(() => result.current.handleRenamed('Александр'))
    expect(result.current.user).toEqual({ id: 'u2', name: 'Александр', role: 'admin' })
    expect(result.current.handleRenamed).toBe(fn)
  })
})
