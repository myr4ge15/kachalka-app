// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rpc = vi.fn()
const hasSession = vi.fn(async () => true)
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, isSessionOf: () => true, hasSession: (...a) => hasSession(...a) }))
vi.mock('../db/local.js', () => ({ getLoginMeta: vi.fn(), setLoginMeta: vi.fn() }))

const { setSex, LoginError } = await import('./auth.js')

describe('setSex (свой пол, v6.2.0)', () => {
  let online
  beforeEach(() => {
    rpc.mockReset()
    hasSession.mockReset().mockResolvedValue(true)
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

  it('нет своей сессии (офлайн-вход) — понятная ошибка, без анонимного запроса', async () => {
    hasSession.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    await expect(setSex('u1', 'f')).rejects.toMatchObject({ code: 'session' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('«permission denied for function» при своей сессии — права на сервере, а не «перезайди»', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function set_my_sex', code: '42501' } })
    const err = await setSex('u1', 'f').catch((e) => e)
    expect(err).toMatchObject({ code: 'server' })
    expect(err.message).toMatch(/прав на set_my_sex.*permission denied/)
  })

  it('протухший JWT — «перезайди»', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'JWT expired' } })
    await expect(setSex('u1', 'f')).rejects.toMatchObject({ code: 'session' })
  })

  it('ошибка сервера (например, RPC ещё не задеплоен) — LoginError server', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function set_my_sex does not exist' } })
    await expect(setSex('u1', 'm')).rejects.toMatchObject({ code: 'server' })
  })
})
