import { describe, it, expect, vi } from 'vitest'
import { createAdminCache, MAX_AGE_MS } from './adminCache.js'

describe('adminCache — кэш списков Админки на визит (v8.0.1)', () => {
  it('запрос в полете склеивается: два раздела — один RPC', async () => {
    const c = createAdminCache()
    const f = vi.fn(async () => ['a'])
    const [x, y] = await Promise.all([c.load('users', f), c.load('users', f)])
    expect(x).toEqual(['a']); expect(y).toEqual(['a'])
    expect(f).toHaveBeenCalledTimes(1)
    expect(c.peek('users')).toEqual(['a'])
  })

  it('свежие данные — без сети; старше MAX_AGE_MS или force — снова в сеть', async () => {
    let t = 0
    const c = createAdminCache(() => t)
    const f = vi.fn(async () => t)
    await c.load('k', f)
    await c.load('k', f)
    expect(f).toHaveBeenCalledTimes(1)
    await c.load('k', f, { force: true })
    expect(f).toHaveBeenCalledTimes(2)
    t = MAX_AGE_MS + 1
    expect(c.isFresh('k')).toBe(false)
    await c.load('k', f)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('invalidate: данные остаются для показа, следующий load идет в сеть', async () => {
    const c = createAdminCache()
    const f = vi.fn(async () => 1)
    await c.load('k', f)
    c.invalidate('k')
    expect(c.peek('k')).toBe(1)
    await c.load('k', f)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('ошибка не кэшируется: следующий load повторяет запрос', async () => {
    const c = createAdminCache()
    const f = vi.fn().mockRejectedValueOnce(new Error('сеть')).mockResolvedValueOnce('ok')
    await expect(c.load('k', f)).rejects.toThrow('сеть')
    expect(c.peek('k')).toBeUndefined()
    await expect(c.load('k', f)).resolves.toBe('ok')
  })
})
