import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DB_TIMEOUT_MS, withTimeout } from './withTimeout.js'

// Билдер PostgREST в миниатюре: thenable + abortSignal(), как supabase.from()/rpc().
function fakeBuilder(result) {
  let signal = null
  let settle
  const promise = new Promise((resolve) => { settle = resolve })
  const builder = {
    abortSignal: vi.fn((s) => { signal = s; return builder }),
    then: (ok, fail) => promise.then(ok, fail),
  }
  return { builder, signal: () => signal, finish: () => settle(result) }
}

describe('withTimeout', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('отдает ответ запроса, если он успел, и не оставляет таймер', async () => {
    const q = fakeBuilder({ data: 1, error: null })
    const p = withTimeout(q.builder, 1000)
    q.finish()
    await expect(p).resolves.toEqual({ data: 1, error: null })
    expect(q.signal().aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('по таймауту отклоняется понятной ошибкой и ОТМЕНЯЕТ запрос', async () => {
    const q = fakeBuilder({ data: 1 })
    const p = withTimeout(q.builder, 1000)
    const caught = expect(p).rejects.toThrow('Превышено время ожидания сети')
    await vi.advanceTimersByTimeAsync(1000)
    await caught
    expect(q.builder.abortSignal).toHaveBeenCalledTimes(1)
    expect(q.signal().aborted).toBe(true)
  })

  it('обычный промис (без abortSignal) работает без отмены', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
    const hang = new Promise(() => {})
    const p = withTimeout(hang, 50)
    const caught = expect(p).rejects.toThrow('Превышено время ожидания')
    await vi.advanceTimersByTimeAsync(50)
    await caught
  })

  it('ошибка запроса пробрасывается как есть', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('по умолчанию — 30 секунд (холодный старт free-tier)', async () => {
    expect(DB_TIMEOUT_MS).toBe(30000)
    const p = withTimeout(new Promise(() => {}))
    let rejected = false
    p.catch(() => { rejected = true })
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS - 1)
    expect(rejected).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(rejected).toBe(true)
  })
})
