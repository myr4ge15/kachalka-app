// «Друзья»: онлайн-операции lib/friends.js (RPC подменены) — гарды сети и сессии, тексты
// ошибок, нормализация кода до запроса (покрытие тестами 20.10.2026: было 41 % строк).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
let session = true
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, hasSession: async () => session }))
const { friendsApi, FriendError } = await import('./friends.js')

beforeEach(() => { rpc.mockReset(); session = true; vi.stubGlobal('navigator', { onLine: true }) })
afterEach(() => vi.unstubAllGlobals())

const api = friendsApi('me')

describe('friendsApi — гарды', () => {
  it('офлайн — «Нужен интернет», к серверу не ходим', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.list()).rejects.toThrow('Нужен интернет.')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('нет своей сессии — просим войти, к серверу не ходим', async () => {
    session = false
    await expect(api.remove('u1')).rejects.toBeInstanceOf(FriendError)
    await expect(api.remove('u1')).rejects.toThrow(/Войди в свою учетную запись/)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('запрос оборвался (сеть) — «Нет сети»', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.block('u1')).rejects.toThrow('Нет сети — попробуй позже.')
  })
})

describe('friendsApi — ошибки сервера человеческим текстом', () => {
  const cases = [
    [{ code: '42501', message: 'permission denied' }, /Войди в свою учетную запись/],
    [{ message: 'forbidden' }, /Войди в свою учетную запись/],
    [{ message: 'rate limited' }, 'Слишком часто — попробуй завтра.'],
    [{ code: 'PGRST202', message: 'no function' }, '«Друзья» пока недоступны. Попробуй позже.'],
    [{ code: 'PGRST301', message: 'x' }, /Сессия устарела/],
    [{ message: 'JWT expired' }, /Сессия устарела/],
    [{ code: 'P0001', message: 'boom' }, 'Не получилось — попробуй еще раз. (P0001)'],
    [{ message: 'boom' }, 'Не получилось — попробуй еще раз.'],
  ]
  for (const [error, text] of cases) {
    it(`${error.code ?? ''} ${error.message}`, async () => {
      rpc.mockResolvedValue({ data: null, error })
      await expect(api.request('u1')).rejects.toThrow(text)
    })
  }
})

describe('friendsApi — контракт RPC', () => {
  it('list — fr_list без аргументов, пустой ответ → []', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await api.list()).toEqual([])
    expect(rpc).toHaveBeenCalledWith('fr_list')
  })
  it('мой код: первая строка ответа, rotate уходит флагом', async () => {
    rpc.mockResolvedValue({ data: [{ code: '7F3Q9XWD' }], error: null })
    expect(await api.myCode()).toEqual({ code: '7F3Q9XWD' })
    expect(rpc).toHaveBeenLastCalledWith('fr_my_code', { p_rotate: false })
    await api.myCode(true)
    expect(rpc).toHaveBeenLastCalledWith('fr_my_code', { p_rotate: true })
  })
  it('превью и принятие кода: нормализация до запроса, мусор — invalid без запроса', async () => {
    expect(await api.preview('xx')).toEqual({ status: 'invalid' })
    expect(await api.acceptCode('')).toEqual({ status: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ data: [{ status: 'ok', inviter_name: 'Маша' }], error: null })
    expect(await api.preview('7f3q-9xwd')).toEqual({ status: 'ok', inviter_name: 'Маша' })
    expect(rpc).toHaveBeenLastCalledWith('fr_preview', { p_code: '7F3Q9XWD' })
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await api.acceptCode('7F3Q-9XWD')).toEqual({ status: 'invalid' }) // пустой ответ — как неверный код
    expect(rpc).toHaveBeenLastCalledWith('fr_accept_code', { p_code: '7F3Q9XWD' })
  })
  it('действия над парой — свои RPC, ответ заявки — булевым', async () => {
    rpc.mockResolvedValue({ data: 'ok', error: null })
    await api.request('u1'); expect(rpc).toHaveBeenLastCalledWith('fr_request', { p_user: 'u1' })
    await api.respond('u1', 1); expect(rpc).toHaveBeenLastCalledWith('fr_respond', { p_user: 'u1', p_accept: true })
    await api.respond('u1', 0); expect(rpc).toHaveBeenLastCalledWith('fr_respond', { p_user: 'u1', p_accept: false })
    await api.cancel('u1'); expect(rpc).toHaveBeenLastCalledWith('fr_cancel', { p_user: 'u1' })
    await api.remove('u1'); expect(rpc).toHaveBeenLastCalledWith('fr_remove', { p_user: 'u1' })
    await api.block('u1'); expect(rpc).toHaveBeenLastCalledWith('fr_block', { p_user: 'u1' })
    expect(await api.unblock('u1')).toBe('ok')
    expect(rpc).toHaveBeenLastCalledWith('fr_unblock', { p_user: 'u1' })
  })
})
