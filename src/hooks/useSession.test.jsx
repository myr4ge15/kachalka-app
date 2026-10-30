// @vitest-environment jsdom
// Сессия приложения (v6.14.1, вынесена из App.jsx): восстановление, вход, выход,
// SIGNED_OUT. Главное — порядок: персональная база открыта ДО setUser, а при выходе
// экраны снимаются (user=null) ДО закрытия базы.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const order = []
const gate = vi.hoisted(() => ({ promise: Promise.resolve() }))
let authListener = null
vi.mock('../db/supabase.js', () => ({
  supabase: { auth: { onAuthStateChange: (cb) => { authListener = cb; return { data: { subscription: { unsubscribe: vi.fn() } } } } } },
}))
vi.mock('../lib/auth.js', () => ({
  logout: vi.fn(async (before) => { await before?.(); await gate.promise; order.push('authLogout') }),
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
import { openUserDb } from '../db/local.js'

// Записываем в order момент, когда хук отдал user (после рендера).
function track() {
  return renderHook(() => {
    const s = useSession(() => order.push('onLoggedIn'))
    return s
  })
}

beforeEach(() => { order.length = 0; authListener = null; gate.promise = Promise.resolve(); localStorage.clear() })
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

  it('выход: user=null и база закрыта сразу, пуш и signOut — в фоне; второй вызов — тот же промис', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня' }))
    order.length = 0
    let p1, p2
    await act(async () => { p1 = result.current.handleLogout(); p2 = result.current.handleLogout(); await p1 })
    expect(p1).toBe(p2)
    expect(order).toEqual(expect.arrayContaining(['releasePush', 'close', 'authLogout']))
    expect(order.indexOf('releasePush')).toBeLessThan(order.indexOf('authLogout'))
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('экран входа не ждет сеть: пока выход идет в фоне, user уже null', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня' }))
    let release
    gate.promise = new Promise((r) => { release = r })
    let done = false
    act(() => { result.current.handleLogout().then(() => { done = true }) })
    expect(result.current.user).toBeNull()
    expect(order).toContain('close')
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(done).toBe(false)
    await act(async () => { release(); await gate.promise })
    await waitFor(() => expect(done).toBe(true))
  })

  it('SIGNED_OUT своего фонового выхода не трогает уже вошедшего следующего', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u1', name: 'Дима' }))
    let release
    gate.promise = new Promise((r) => { release = r })
    act(() => { result.current.handleLogout() })
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Аня' }))
    act(() => authListener('SIGNED_OUT'))
    expect(result.current.user?.id).toBe('u2')
    await act(async () => { release(); await gate.promise })
  })

  it('SIGNED_OUT от Supabase — на экран входа, база закрыта', async () => {
    const { result } = track()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня' }))
    act(() => authListener('SIGNED_OUT'))
    expect(result.current.user).toBeNull()
    expect(order.at(-1)).toBe('close')
  })

  it('SIGNED_IN: подписка на пуши еще раз сверяется — за вошедшей учеткой; до входа — нет', async () => {
    const { result } = track()
    await waitFor(() => expect(order).toEqual(['ready']))
    act(() => authListener('SIGNED_IN'))
    expect(reconcilePushOwner).not.toHaveBeenCalled()
    await act(() => result.current.handleLogin({ id: 'u2', name: 'Саня' }))
    vi.mocked(reconcilePushOwner).mockClear()
    act(() => authListener('SIGNED_IN'))
    expect(reconcilePushOwner).toHaveBeenCalledWith('u2')
    act(() => authListener('TOKEN_REFRESHED'))
    expect(reconcilePushOwner).toHaveBeenCalledOnce()
  })

  it('персональная база не открылась — экран входа, след в консоли, сплэш все равно снят', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(openUserDb).mockRejectedValueOnce(new Error('IDB blocked'))
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: 'u1' }))
    const { result } = track()
    await waitFor(() => expect(order).toContain('ready'))
    expect(result.current.user).toBeNull()
    expect(err).toHaveBeenCalledWith('Не удалось восстановить сессию:', expect.any(Error))
    err.mockRestore()
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
