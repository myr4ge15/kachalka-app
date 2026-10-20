// «Мой круг» и приглашения: онлайн-операции lib/friendCircles.js и lib/memberInvites.js
// (RPC подменены) — гарды, тексты ошибок, проверки до запроса, контракт RPC
// (покрытие тестами 20.10.2026: было 64 % и 65 % строк).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
let session = true
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, hasSession: async () => session }))
const fc = await import('./friendCircles.js')
const { memberInviteApi } = await import('./memberInvites.js')

beforeEach(() => { rpc.mockReset(); session = true; vi.stubGlobal('navigator', { onLine: true }) })
afterEach(() => vi.unstubAllGlobals())

const api = fc.circleApi('me')
const ok = (data) => rpc.mockResolvedValue({ data, error: null })
const fail = (error) => rpc.mockResolvedValue({ data: null, error })

describe('circleApi — гарды и ошибки', () => {
  it('офлайн, чужая сессия, обрыв сети', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.myCircles()).rejects.toThrow('Нужен интернет.')
    vi.stubGlobal('navigator', { onLine: true })
    session = false
    await expect(api.leave('c1')).rejects.toThrow(/Войди в свою учетную запись/)
    expect(rpc).not.toHaveBeenCalled()
    session = true
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.leave('c1')).rejects.toThrow('Нет сети — попробуй позже.')
  })

  const cases = [
    [{ code: '42501', message: '' }, /Нет доступа/],
    [{ message: 'forbidden' }, /Нет доступа/],
    [{ message: 'own circle exists' }, 'Свой круг у тебя уже есть.'],
    [{ message: 'max circles' }, 'Можно быть не больше чем в 5 кругах.'],
    [{ message: 'bad name' }, 'Название — от 1 до 40 символов.'],
    [{ message: 'rate limited' }, 'Слишком часто — попробуй завтра.'],
    [{ message: 'упражнение недоступно' }, 'Это упражнение нельзя взять в рейтинг.'],
    [{ code: 'PGRST202', message: '' }, '«Мой круг» пока недоступен. Попробуй позже.'],
    [{ message: 'JWT expired' }, /Сессия устарела/],
    [{ code: 'P0001', message: 'x' }, 'Не получилось — попробуй еще раз. (P0001)'],
  ]
  for (const [error, text] of cases) {
    it(`${error.code ?? ''} ${error.message}`.trim(), async () => {
      fail(error)
      await expect(api.rename('c1', 'Зал')).rejects.toBeInstanceOf(fc.CircleError)
      await expect(api.rename('c1', 'Зал')).rejects.toThrow(text)
    })
  }
})

describe('circleApi — контракт RPC', () => {
  it('создание: пробелы схлопнуты, пустое и длиннее 40 — без запроса', async () => {
    await expect(api.create('   ')).rejects.toThrow('от 1 до 40')
    await expect(api.create('x'.repeat(41))).rejects.toThrow('от 1 до 40')
    expect(rpc).not.toHaveBeenCalled()
    ok('c1')
    expect(await api.create('  Наш   зал ')).toBe('c1')
    expect(rpc).toHaveBeenLastCalledWith('fc_create', { p_name: 'Наш зал' })
  })

  it('коды: мусор — invalid без запроса, нормальный — нормализован, пустой ответ — invalid', async () => {
    expect(await api.preview('xx')).toEqual({ status: 'invalid' })
    expect(await api.join('')).toEqual({ status: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
    ok([{ status: 'ok', circle_name: 'Бег' }])
    expect(await api.preview('7f3q-9xwd')).toEqual({ status: 'ok', circle_name: 'Бег' })
    expect(rpc).toHaveBeenLastCalledWith('fc_preview', { p_code: '7F3Q9XWD' })
    ok(null)
    expect(await api.join('7F3Q-9XWD')).toEqual({ status: 'invalid' })
    expect(rpc).toHaveBeenLastCalledWith('fc_join', { p_code: '7F3Q9XWD' })
  })

  it('списки: пустой ответ → []', async () => {
    ok(null)
    expect(await api.myCircles()).toEqual([])
    expect(await api.members('c1')).toEqual([])
    expect(await api.codes('c1')).toEqual([])
    expect(await api.disciplines('c1')).toEqual([])
    expect(rpc).toHaveBeenLastCalledWith('fc_rating_catalog', { p_circle: 'c1', p_all: true })
  })

  it('управление кругом — свои RPC, флаги булевые', async () => {
    ok('ok')
    const calls = [
      [() => api.rename('c1', '  Зал '), 'fc_rename', { p_circle: 'c1', p_name: 'Зал' }],
      [() => api.setAutoApprove('c1', 1), 'fc_set_auto_approve', { p_circle: 'c1', p_on: true }],
      [() => api.myCode('c1'), 'fc_my_code', { p_circle: 'c1', p_rotate: false }],
      [() => api.leave('c1'), 'fc_leave', { p_circle: 'c1' }],
      [() => api.decide('c1', 'u2', 0), 'fc_decide', { p_circle: 'c1', p_user: 'u2', p_approve: false }],
      [() => api.remove('c1', 'u2'), 'fc_remove', { p_circle: 'c1', p_user: 'u2' }],
      [() => api.revokeCode('k1'), 'fc_revoke_code', { p_code_id: 'k1' }],
      [() => api.transfer('c1', 'u2'), 'fc_transfer', { p_circle: 'c1', p_user: 'u2' }],
      [() => api.remove_circle('c1'), 'fc_delete', { p_circle: 'c1' }],
    ]
    for (const [call, name, args] of calls) {
      await call()
      expect(rpc).toHaveBeenLastCalledWith(name, args)
    }
  })

  it('ссылка с мусором в адресе — null, без исключения', () => {
    expect(fc.joinFromUrl('не адрес')).toBeNull()
    expect(fc.stripJoin('не адрес')).toBeNull()
    expect(fc.joinUrl('7f3q9xwd', 'https://x.io', '/app')).toBe('https://x.io/app/#join=7F3Q9XWD')
    expect(fc.joinMessage({})).not.toMatch(/Код:/)
  })

  it('все статусы вступления — свой текст', () => {
    for (const s of ['active', 'already', 'max_circles', 'full', 'limited', 'busy']) {
      expect(fc.joinStatusText(s)).not.toMatch(/позже\.$/)
    }
    expect(fc.codeMeta({ uses: 2 })).toBe('вступили 2 из 10')
  })
})

describe('memberInviteApi', () => {
  const inv = memberInviteApi('me')
  it('без своей сессии — просим войти', async () => {
    session = false
    await expect(inv.list()).rejects.toThrow(/Войди/)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('список: пустой ответ → []', async () => {
    ok(null)
    expect(await inv.list()).toEqual([])
    expect(rpc).toHaveBeenLastCalledWith('my_invites', undefined)
  })
  it('создание: пометка обрезана, длиннее 60 — без запроса; без токена — ошибка', async () => {
    await expect(inv.create('x'.repeat(61))).rejects.toThrow('до 60')
    expect(rpc).not.toHaveBeenCalled()
    ok([{ token: 't1', id: 'i1' }])
    expect(await inv.create('  для Пети ')).toEqual({ token: 't1', id: 'i1' })
    expect(rpc).toHaveBeenLastCalledWith('create_my_invite', { p_note: 'для Пети' })
    ok({ id: 'i2' })
    await expect(inv.create()).rejects.toThrow('Сервер не вернул ссылку.')
    expect(rpc).toHaveBeenLastCalledWith('create_my_invite', { p_note: null })
  })
  it('ошибки сервера — понятным текстом', async () => {
    for (const [error, text] of [
      [{ message: 'active invite limit' }, /3 активные ссылки/],
      [{ code: '42501', message: '' }, 'Сессия завершилась. Войди заново.'],
      [{ code: 'PGRST202', message: '' }, 'Приглашения пока недоступны. Попробуй позже.'],
      [{ message: 'invite already used' }, 'По этой ссылке уже зарегистрировались.'],
      [{ message: 'not found' }, 'Приглашение не найдено.'],
      [{ message: 'boom' }, /Проверь связь/],
    ]) {
      fail(error)
      await expect(inv.revoke('i1')).rejects.toThrow(text)
    }
    expect(rpc).toHaveBeenLastCalledWith('revoke_my_invite', { p_id: 'i1' })
  })
})
