import { describe, expect, it, vi } from 'vitest'
import {
  JOIN_KEY, JoinError, clearPending, joinErrorText, loadPending, pollJoin, randomSecret, savePending,
  submitJoin, validateJoin,
} from './joinRequest.js'

function memStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}
const reply = (status, body) => vi.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }))

describe('joinRequest', () => {
  it('validateJoin: имя обязательно, лимиты длины', () => {
    expect(validateJoin({ name: '  ' })).toMatch(/как тебя зовут/)
    expect(validateJoin({ name: 'x'.repeat(41) })).toMatch(/до 40/)
    expect(validateJoin({ name: 'Вася', about: 'x'.repeat(301) })).toMatch(/до 300/)
    expect(validateJoin({ name: 'Вася', about: 'друг Димы' })).toBeNull()
  })

  it('randomSecret — 43 символа base64url и каждый раз новый', () => {
    const a = randomSecret(), b = randomSecret()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })

  it('submitJoin шлет секрет и сохраняет заявку локально', async () => {
    const storage = memStorage()
    const fetchImpl = reply(200, { id: 'r1' })
    const p = await submitJoin({ name: ' Вася ', about: ' привет ' }, { fetchImpl, storage, now: () => 5 })
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(sent).toMatchObject({ action: 'submit', name: 'Вася', about: 'привет', website: '' })
    expect(sent.secret).toBe(p.secret)
    expect(p).toEqual({ id: 'r1', secret: sent.secret, name: 'Вася', at: 5 })
    expect(loadPending(storage)).toEqual(p)
    clearPending(storage)
    expect(loadPending(storage)).toBeNull()
  })

  it('ошибки сервера → коды JoinError и понятный текст', async () => {
    const storage = memStorage()
    await expect(submitJoin({ name: 'Вася' }, { fetchImpl: reply(429, { error: 'rate_limited' }), storage })).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(submitJoin({ name: 'Вася' }, { fetchImpl: reply(400, {}), storage })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(submitJoin({ name: 'Вася' }, { fetchImpl: reply(500, {}), storage })).rejects.toMatchObject({ code: 'server' })
    await expect(submitJoin({ name: 'Вася' }, { fetchImpl: vi.fn(async () => { throw new TypeError('offline') }), storage })).rejects.toBeInstanceOf(JoinError)
    expect(loadPending(storage)).toBeNull()
    expect(joinErrorText('rate_limited')).toMatch(/завтра/)
    expect(joinErrorText('network')).toMatch(/связи/)
  })

  it('pollJoin: статус и токен один раз', async () => {
    const p = { id: 'r1', secret: 's' }
    expect(await pollJoin(p, { fetchImpl: reply(200, { status: 'new' }) })).toEqual({ status: 'new' })
    const f = reply(200, { status: 'approved', token: 'T' })
    expect(await pollJoin(p, { fetchImpl: f })).toEqual({ status: 'approved', token: 'T' })
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'poll', id: 'r1', secret: 's' })
    expect(await pollJoin(p, { fetchImpl: reply(200, {}) })).toEqual({ status: 'invalid' })
  })

  it('битое или чужое значение в localStorage — нет заявки', () => {
    const storage = memStorage()
    storage.setItem(JOIN_KEY, '{oops'); expect(loadPending(storage)).toBeNull()
    storage.setItem(JOIN_KEY, '{"id":1}'); expect(loadPending(storage)).toBeNull()
    savePending({ id: 'a', secret: 'b' }, storage); expect(loadPending(storage)).toEqual({ id: 'a', secret: 'b' })
    expect(loadPending(null)).toBeNull()
  })
})
