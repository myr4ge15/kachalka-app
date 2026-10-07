// «Мой круг»: код, ссылка, тексты и онлайн-операции (RPC подменены).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
let session = true
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, hasSession: async () => session }))
const fc = await import('./friendCircles.js')

beforeEach(() => { rpc.mockReset(); session = true; vi.stubGlobal('navigator', { onLine: true }) })
afterEach(() => vi.unstubAllGlobals())

describe('код', () => {
  it('нормализация — как fc_code_norm в SQL', () => {
    expect(fc.normCode('7f3q-9xwd')).toBe('7F3Q9XWD')
    expect(fc.normCode(' o1il 9xwd')).toBe('01119XWD')
    expect(fc.normCode('7F3Q-9XWU')).toBe(null)
    expect(fc.normCode('7F3Q9XW')).toBe(null)
    expect(fc.fmtCode('7f3q9xwd')).toBe('7F3Q-9XWD')
    expect(fc.fmtCode('мусор')).toBe('')
  })
  it('ссылка #join=…: собрать, достать, стереть', () => {
    const url = fc.joinUrl('7f3q-9xwd', 'https://x.io', '/kachalka-app/')
    expect(url).toBe('https://x.io/kachalka-app/#join=7F3Q9XWD')
    expect(fc.joinFromUrl(url)).toBe('7F3Q9XWD')
    expect(fc.joinFromUrl('https://x.io/kachalka-app/#join=xx')).toBe(null)
    expect(fc.stripJoin(url)).toBe('https://x.io/kachalka-app/')
    expect(fc.stripJoin('https://x.io/#invite=1')).toBe(null)
  })
  it('текст приглашения: круг, код, ссылка последней строкой', () => {
    const t = fc.joinMessage({ circle: 'Зал', code: '7F3Q9XWD', url: 'https://x' }).split('\n')
    expect(t[0]).toMatch(/«Зал»/)
    expect(t).toContain('Код: 7F3Q-9XWD')
    expect(t.at(-1)).toBe('https://x')
  })
  it('статусы и срок', () => {
    expect(fc.joinStatusText('pending')).toMatch(/владелец/)
    expect(fc.joinStatusText('invalid')).toMatch(/не подходит/)
    expect(fc.joinStatusText('???')).toMatch(/позже/)
    expect(fc.codeMeta({ expires_at: '2026-10-14T12:00:00Z', uses: 3, max_uses: 10 })).toBe('до 14.10 · вступили 3 из 10')
  })
})

describe('онлайн-операции', () => {
  const api = () => fc.circleApi('u1')
  it('офлайн и без сессии — без запроса', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api().myCircles()).rejects.toThrow('интернет')
    vi.stubGlobal('navigator', { onLine: true })
    session = false
    await expect(api().myCircles()).rejects.toThrow('Войди')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('создать: имя чистится, пустое — без запроса', async () => {
    await expect(api().create('  ')).rejects.toThrow('от 1 до 40')
    rpc.mockResolvedValueOnce({ data: 'c1', error: null })
    expect(await api().create('  Зал   на  Ленина ')).toBe('c1')
    expect(rpc).toHaveBeenCalledWith('fc_create', { p_name: 'Зал на Ленина' })
  })
  it('вступить: код нормализуется; мусор — invalid без запроса', async () => {
    expect(await api().join('abc')).toEqual({ status: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValueOnce({ data: [{ status: 'active', circle_id: 'c1' }], error: null })
    expect(await api().join('7f3q-9xwd')).toEqual({ status: 'active', circle_id: 'c1' })
    expect(rpc).toHaveBeenCalledWith('fc_join', { p_code: '7F3Q9XWD' })
  })
  it('ошибки сервера — понятный текст', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden' } })
    await expect(api().members('c1')).rejects.toThrow('Нет доступа')
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'own circle exists' } })
    await expect(api().create('Зал')).rejects.toThrow('Свой круг у тебя уже есть')
    rpc.mockRejectedValueOnce(new TypeError('fetch'))
    await expect(api().myCircles()).rejects.toThrow('Нет сети')
  })
  it('код, дисциплины — нужные RPC и аргументы', async () => {
    rpc.mockResolvedValue({ data: [{ code: '7F3Q9XWD' }], error: null })
    expect(await api().myCode('c1', true)).toEqual({ code: '7F3Q9XWD' })
    expect(rpc).toHaveBeenLastCalledWith('fc_my_code', { p_circle: 'c1', p_rotate: true })
    await api().saveDiscipline('c1', 'e1', 1, 0)
    expect(rpc).toHaveBeenLastCalledWith('fc_save_discipline', { p_circle: 'c1', p_exercise_id: 'e1', p_split_by_sex: true, p_enabled: false })
    await api().disciplines('c1')
    expect(rpc).toHaveBeenLastCalledWith('fc_rating_catalog', { p_circle: 'c1', p_all: true })
  })
})
