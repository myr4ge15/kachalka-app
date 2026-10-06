// lib/admin.js (v6.14.2, замер покрытия 06.10: 3% — тесты Админки мокали модуль целиком).
// Здесь — сам модуль: проверки ввода ДО сети, что уходит в RPC/Edge, как ответы
// сервера превращаются в тексты (403/401/404/409, mfa_required, weak_pin, сеть) и
// локальное зеркалирование правок упражнений.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const getSession = vi.fn(async () => ({ data: { session: { access_token: 'tok' } } }))
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), auth: { getSession: () => getSession() } } }))
const exercisesInCache = []
vi.mock('../db/local.js', () => ({
  db: { exercises: { filter: (fn) => ({ toArray: async () => exercisesInCache.filter(fn) }) } },
}))
vi.mock('../db/repo.js', () => ({ applyExerciseEditLocal: vi.fn(async () => {}), applyExerciseMergeLocal: vi.fn(async () => {}) }))

import * as admin from './admin.js'
import { applyExerciseEditLocal, applyExerciseMergeLocal } from '../db/repo.js'
import { WEAK_PIN_TEXT } from './pinPolicy.js'

const { AdminError, MFA_REQUIRED_TEXT } = admin
const ok = (data) => Promise.resolve({ data, error: null })
const err = (message) => Promise.resolve({ data: null, error: { message } })
function reply(status, body) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, json: async () => body })
}

beforeEach(() => { exercisesInCache.length = 0; vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('участники (RPC)', () => {
  it('список: нормализует поля, пол/порядок по умолчанию null', async () => {
    rpc.mockReturnValueOnce(ok([{ id: 'u1', name: 'Дима', role: 'member', is_private: 1, created_at: 't' }]))
    expect(await admin.adminListUsers()).toEqual([{ id: 'u1', name: 'Дима', role: 'member', is_private: true, sex: null, sort_order: null, created_at: 't' }])
    rpc.mockReturnValueOnce(err('boom'))
    await expect(admin.adminListUsers()).rejects.toThrow('boom')
  })

  it('имя/роль: проверка ДО сети, ошибки сервера по-человечески', async () => {
    await expect(admin.adminSetUser('u1', ' ', 'member')).rejects.toThrow('Имя — от 1 до 40')
    await expect(admin.adminSetUser('u1', 'Дима', 'boss')).rejects.toThrow('Недопустимая роль')
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockReturnValueOnce(ok(null))
    expect(await admin.adminSetUser('u1', '  Дима ', 'admin')).toEqual({ id: 'u1', name: 'Дима', role: 'admin' })
    expect(rpc).toHaveBeenCalledWith('admin_set_user', { p_id: 'u1', p_name: 'Дима', p_role: 'admin' })
    rpc.mockReturnValueOnce(err('cannot demote last admin'))
    await expect(admin.adminSetUser('u1', 'Дима', 'member')).rejects.toThrow('Нельзя снять роль с последнего админа')
    rpc.mockReturnValueOnce(err('duplicate key value violates users_name_key_uidx'))
    await expect(admin.adminSetUser('u1', 'Маша', 'member')).rejects.toThrow('Это имя уже занято')
  })

  it('приватность, пол, порядок, удаление', async () => {
    rpc.mockReturnValue(ok(null))
    expect(await admin.adminSetPrivate('u1', 'да')).toEqual({ id: 'u1', is_private: true })
    expect(await admin.adminSetSex('u1', 'x')).toEqual({ id: 'u1', sex: null })
    expect(rpc).toHaveBeenLastCalledWith('admin_set_sex', { p_id: 'u1', p_sex: null })
    expect(await admin.adminSetSex('u1', 'f')).toEqual({ id: 'u1', sex: 'f' })
    await expect(admin.adminSetUserOrder([])).rejects.toThrow('Пустой список')
    expect(await admin.adminSetUserOrder(['a', 'b'])).toBe(true)
    expect(rpc).toHaveBeenLastCalledWith('admin_set_user_order', { p_ids: ['a', 'b'] })
    rpc.mockReturnValueOnce(err('cannot delete yourself'))
    await expect(admin.adminDeleteUser('me')).rejects.toThrow('Нельзя удалить самого себя')
    rpc.mockReturnValueOnce(err('forbidden: admin only'))
    await expect(admin.adminSetPrivate('u1', false)).rejects.toThrow('Нужны права админа')
  })
})

describe('сброс PIN (Edge)', () => {
  it('слабый или кривой PIN — отказ без сети', async () => {
    await expect(admin.adminResetPin('u1', '12')).rejects.toThrow('PIN — 4 цифры')
    await expect(admin.adminResetPin('u1', '1111')).rejects.toThrow(WEAK_PIN_TEXT)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('без сессии — понятная ошибка', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    await expect(admin.adminResetPin('u1')).rejects.toThrow('Сессия не найдена')
  })
  it('успех: токен сессии в заголовке, PIN из ответа; без new_pin — сервер генерирует', async () => {
    fetch.mockReturnValueOnce(reply(200, { ok: true, pin: '4826' }))
    expect(await admin.adminResetPin('u1')).toBe('4826')
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/admin-reset-pin$/)
    expect(opts.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body)).toEqual({ target_user_id: 'u1' })
  })
  it.each([
    [403, { error: 'mfa_required' }, MFA_REQUIRED_TEXT],
    [403, { error: 'forbidden' }, 'Нужны права админа.'],
    [401, {}, 'Сессия истекла — войди заново.'],
    [404, {}, 'Участник не найден.'],
    [400, { error: 'weak_pin' }, WEAK_PIN_TEXT],
    [429, { error: 'rate_limited' }, 'rate_limited'],
  ])('ответ %s %j → «%s»', async (status, body, text) => {
    fetch.mockReturnValueOnce(reply(status, body))
    await expect(admin.adminResetPin('u1', '4826')).rejects.toThrow(text)
  })
  it('сеть упала — «Нет сети»', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(admin.adminResetPin('u1')).rejects.toThrow('Нет сети')
  })
})

describe('создание участника (Edge)', () => {
  it('проверки ввода до сети', async () => {
    await expect(admin.adminCreateUser('', 'member', '4826')).rejects.toThrow('Имя')
    await expect(admin.adminCreateUser('Вася', 'god', '4826')).rejects.toThrow('роль')
    await expect(admin.adminCreateUser('Вася', 'member', '12a4')).rejects.toThrow('4 цифры')
    await expect(admin.adminCreateUser('Вася', 'member', '1234')).rejects.toThrow(WEAK_PIN_TEXT)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('успех и коды ошибок', async () => {
    fetch.mockReturnValueOnce(reply(200, { ok: true, user: { id: 'n1', name: 'Вася', role: 'member' } }))
    expect(await admin.adminCreateUser(' Вася ', 'member', '4826')).toEqual({ id: 'n1', name: 'Вася', role: 'member' })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: 'Вася', role: 'member', pin: '4826' })
    fetch.mockReturnValueOnce(reply(409, { error: 'name_taken' }))
    await expect(admin.adminCreateUser('Вася', 'member', '4826')).rejects.toThrow('Имя уже занято')
    fetch.mockReturnValueOnce(reply(403, { error: 'mfa_required' }))
    await expect(admin.adminCreateUser('Вася', 'member', '4826')).rejects.toThrow(MFA_REQUIRED_TEXT)
    fetch.mockReturnValueOnce(reply(500, null))
    await expect(admin.adminCreateUser('Вася', 'member', '4826')).rejects.toThrow('Не удалось создать участника')
  })
})

describe('приглашения и связи', () => {
  it('приглашение: пометка ≤60, токен обязателен', async () => {
    await expect(admin.adminCreateInvite('x'.repeat(61))).rejects.toThrow('до 60')
    rpc.mockReturnValueOnce(ok([{ id: 'i1', token: 'T', expires_at: 'e' }]))
    expect(await admin.adminCreateInvite('  ')).toEqual({ id: 'i1', token: 'T', expires_at: 'e' })
    expect(rpc).toHaveBeenLastCalledWith('admin_create_invite', { p_note: null })
    rpc.mockReturnValueOnce(ok([{ id: 'i1' }]))
    await expect(admin.adminCreateInvite()).rejects.toThrow('не вернул ссылку')
    rpc.mockReturnValueOnce(ok(null))
    expect(await admin.adminListInvites()).toEqual([])
    rpc.mockReturnValueOnce(err('invite already used'))
    await expect(admin.adminRevokeInvite('i1')).rejects.toThrow('уже воспользовались')
  })
  it('связи: статус по умолчанию accepted; пара из одного человека — отказ', async () => {
    rpc.mockReturnValueOnce(ok([{ low_id: 'a', high_id: 'b' }]))
    expect(await admin.adminListConnections()).toEqual([{ low_id: 'a', high_id: 'b', status: 'accepted' }])
    await expect(admin.adminSetConnection('a', 'a', true)).rejects.toThrow('два разных')
    rpc.mockReturnValueOnce(ok(null))
    expect(await admin.adminSetConnection('a', 'b', 1)).toEqual({ a: 'a', b: 'b', connected: true })
  })
})

describe('упражнения: сервер + локальное зеркало', () => {
  it('правка: подмышца по умолчанию, metric шлется только если задан; флаг жима снимается с других', async () => {
    exercisesInCache.push({ id: 'old', is_bench_lift: true }, { id: 'e1', is_bench_lift: false })
    rpc.mockReturnValue(ok(null))
    const r = await admin.adminUpdateExercise({ id: 'e1', name: ' Жим ', muscle_group: 'грудь', is_bench_lift: true })
    const args = rpc.mock.calls[0][1]
    expect(args).not.toHaveProperty('p_metric')
    expect(args).toMatchObject({ p_id: 'e1', p_name: 'Жим', p_muscle_group: 'грудь', p_is_bench_lift: true })
    expect(args.p_submuscle).toBeTruthy()
    expect(applyExerciseEditLocal).toHaveBeenCalledWith('old', { is_bench_lift: false })
    expect(applyExerciseEditLocal).toHaveBeenLastCalledWith('e1', expect.objectContaining({ name: 'Жим', is_bench_lift: true }))
    expect(r).toMatchObject({ id: 'e1', name: 'Жим', is_bench_lift: true })

    rpc.mockClear()
    await admin.adminUpdateExercise({ id: 'e1', name: 'Планка', muscle_group: 'пресс', metric: 'time' })
    expect(rpc.mock.calls[0][1].p_metric).toBe('time')
    await expect(admin.adminUpdateExercise({ id: 'e1', name: '' })).rejects.toThrow('Название')
  })
  it('ошибка сервера — локальный кэш не трогаем', async () => {
    rpc.mockReturnValueOnce(err('not found'))
    await expect(admin.adminUpdateExercise({ id: 'e1', name: 'Жим' })).rejects.toThrow('Запись не найдена')
    expect(applyExerciseEditLocal).not.toHaveBeenCalled()
  })
  it('слияние: проверки, после успеха — локально прячем старое', async () => {
    await expect(admin.adminMergeExercise('a', '')).rejects.toThrow('оба')
    await expect(admin.adminMergeExercise('a', 'a')).rejects.toThrow('само с собой')
    rpc.mockReturnValueOnce(ok(null))
    expect(await admin.adminMergeExercise('a', 'b')).toBe(true)
    expect(rpc).toHaveBeenCalledWith('admin_merge_exercise', { p_from: 'a', p_into: 'b' })
    expect(applyExerciseMergeLocal).toHaveBeenCalledWith('a')
  })
  it('AdminError — свой класс', () => {
    expect(new AdminError('x')).toBeInstanceOf(Error)
    expect(new AdminError('x').name).toBe('AdminError')
  })
})
