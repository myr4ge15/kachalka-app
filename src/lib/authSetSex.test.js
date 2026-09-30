// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, isSessionOf: () => true }))
vi.mock('../db/local.js', () => ({ getLoginMeta: vi.fn(), setLoginMeta: vi.fn() }))

const { setSex, LoginError } = await import('./auth.js')

describe('setSex (свой пол, v6.2.0)', () => {
  let online
  beforeEach(() => {
    rpc.mockReset()
    online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => online.mockRestore())

  it('зовёт set_my_sex и нормализует мусор в null', async () => {
    rpc.mockResolvedValue({ data: 'f', error: null })
    await expect(setSex('u1', 'f')).resolves.toBe('f')
    expect(rpc).toHaveBeenCalledWith('set_my_sex', { p_sex: 'f' })
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(setSex('u1', 'x')).resolves.toBeNull()
    expect(rpc).toHaveBeenLastCalledWith('set_my_sex', { p_sex: null })
  })

  it('офлайн — понятная ошибка без запроса', async () => {
    online.mockReturnValue(false)
    await expect(setSex('u1', 'm')).rejects.toBeInstanceOf(LoginError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ошибка сервера (например, RPC ещё не задеплоен) — LoginError server', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function set_my_sex does not exist' } })
    await expect(setSex('u1', 'm')).rejects.toMatchObject({ code: 'server' })
  })
})
