// «Видеть всех» — онлайн-вызовы (27.10.2026): контракт RPC, гарды (офлайн, чужая сессия), тексты ошибок.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ rpc: vi.fn(), session: true }))
vi.mock('../db/supabase.js', () => ({
  hasSession: vi.fn(async () => net.session),
  supabase: { rpc: (...a) => net.rpc(...a) },
}))
vi.mock('./admin.js', () => ({
  AdminError: class AdminError extends Error {},
  MFA_REQUIRED_TEXT: 'Нужен код 2FA',
}))
import { viewAllOn, viewAllOff, viewAllState, VIEW_ALL_NO_SQL, VIEW_ALL_OFFLINE, VIEW_ALL_NO_SESSION } from './adminViewAll.js'

const UNTIL = '2026-10-27T12:30:00Z'
beforeEach(() => {
  net.rpc.mockReset()
  net.session = true
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('adminViewAll', () => {
  it('включить — admin_view_all_set с минутами, ответ — срок', async () => {
    net.rpc.mockResolvedValue({ data: UNTIL, error: null })
    expect(await viewAllOn('me', 30)).toBe(UNTIL)
    expect(net.rpc).toHaveBeenCalledWith('admin_view_all_set', { p_minutes: 30 })
  })

  it('выключить — admin_view_all_off без аргументов', async () => {
    net.rpc.mockResolvedValue({ data: null, error: null })
    await viewAllOff('me')
    expect(net.rpc).toHaveBeenCalledWith('admin_view_all_off')
  })

  it('состояние: срок и «чужие»; без режима extra_ids не спрашиваем', async () => {
    net.rpc.mockImplementation(async (name) => name === 'admin_view_all_state'
      ? { data: UNTIL, error: null } : { data: ['a', 'b'], error: null })
    expect(await viewAllState('me')).toEqual({ until: UNTIL, extra: ['a', 'b'] })
    net.rpc.mockReset().mockResolvedValue({ data: null, error: null })
    expect(await viewAllState('me')).toEqual({ until: null, extra: [] })
    expect(net.rpc).toHaveBeenCalledTimes(1)
  })

  it('офлайн и чужая сессия — без запроса, понятным текстом', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(viewAllOn('me', 30)).rejects.toThrow(VIEW_ALL_OFFLINE)
    vi.stubGlobal('navigator', { onLine: true })
    net.session = false
    await expect(viewAllState('me')).rejects.toThrow(VIEW_ALL_NO_SESSION)
    expect(net.rpc).not.toHaveBeenCalled()
  })

  it('ошибки сервера — человеческим текстом', async () => {
    net.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    await expect(viewAllOn('me', 30)).rejects.toThrow(VIEW_ALL_NO_SQL)
    net.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not admin' } })
    await expect(viewAllOn('me', 30)).rejects.toThrow('Нужен код 2FA')
    net.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'view_all_bad_minutes' } })
    await expect(viewAllOn('me', 1)).rejects.toThrow('от 5 минут до 4 часов')
    net.rpc.mockResolvedValue({ data: null, error: { message: '' } })
    await expect(viewAllOff('me')).rejects.toThrow('попробуй еще раз')
  })
})
