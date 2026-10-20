// Комментарии: онлайн-операции lib/comments.js (RPC подменены) — гарды, проверка длины до
// запроса, тексты ошибок сервера, разбор ответа (покрытие тестами 20.10.2026: было 57 %).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
let session = true
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) }, hasSession: async () => session }))
const { addComment, editComment, reactComment, deleteComment, CommentError, COMMENT_MAX } = await import('./comments.js')

beforeEach(() => { rpc.mockReset(); session = true; vi.stubGlobal('navigator', { onLine: true }) })
afterEach(() => vi.unstubAllGlobals())

const ROW = { id: 'c1', workout_id: 'w1', user_id: 'me', author_name: 'Сега', author_known: true, body: 'Мощно', created_at: '2026-10-19T10:00:00Z' }

describe('гарды и длина', () => {
  it('офлайн и чужая сессия — без запроса', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(addComment('me', 'w1', 'привет')).rejects.toThrow('Нет сети.')
    vi.stubGlobal('navigator', { onLine: true })
    session = false
    await expect(deleteComment('me', 'c1')).rejects.toThrow(/Войди в свою учетную запись/)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('пусто, одни пробелы и длиннее лимита — отказ до сервера', async () => {
    for (const text of ['', '   ', 'x'.repeat(COMMENT_MAX + 1)]) {
      await expect(addComment('me', 'w1', text)).rejects.toBeInstanceOf(CommentError)
      await expect(editComment('me', 'c1', text)).rejects.toThrow(`от 1 до ${COMMENT_MAX}`)
    }
    expect(rpc).not.toHaveBeenCalled()
  })
  it('сеть оборвалась — «Нет сети — попробуй позже»', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(reactComment('me', 'c1', 'heart')).rejects.toThrow('Нет сети — попробуй позже.')
  })
})

describe('ошибки сервера человеческим текстом', () => {
  const cases = [
    ['comment_rate_limited', /Слишком много комментариев/],
    ['comment_bad_length', /от 1 до/],
    ['comment_no_workout', 'Эта тренировка тебе больше не видна.'],
    ['comment_not_found', /уже удален/],
    ['comment_own_like', 'На свой комментарий реакцию не поставить.'],
    ['comment_bad_reaction', /Такой реакции нет/],
  ]
  for (const [message, text] of cases) {
    it(message, async () => {
      rpc.mockResolvedValue({ data: null, error: { message } })
      await expect(reactComment('me', 'c1', 'heart')).rejects.toThrow(text)
    })
  }
  it('коды прав, схемы и JWT; прочее — с кодом в скобках', async () => {
    for (const [error, text] of [
      [{ code: '42501', message: '' }, /Войди/],
      [{ code: 'PGRST202', message: '' }, 'Комментарии пока недоступны. Попробуй позже.'],
      [{ code: 'PGRST301', message: '' }, /Сессия устарела/],
      [{ message: 'JWT expired' }, /Сессия устарела/],
      [{ code: 'XX000', message: 'boom' }, 'Не получилось — попробуй еще раз. (XX000)'],
    ]) {
      rpc.mockResolvedValue({ data: null, error })
      await expect(deleteComment('me', 'c1')).rejects.toThrow(text)
    }
  })
})

describe('запросы и разбор ответа', () => {
  it('отправка: текст обрезан, ответ — с p_reply_to, строка нормализована', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null })
    const c = await addComment('me', 'w1', '  Мощно  ')
    expect(rpc).toHaveBeenLastCalledWith('comment_add', { p_workout_id: 'w1', p_body: 'Мощно' })
    expect(c).toMatchObject({ id: 'c1', workout_id: 'w1', name: 'Сега', body: 'Мощно', like_count: 0, liked: false })
    await addComment('me', 'w1', 'и тебе', 'c0')
    expect(rpc).toHaveBeenLastCalledWith('comment_add', { p_workout_id: 'w1', p_body: 'и тебе', p_reply_to: 'c0' })
  })
  it('сервер вернул пустоту — понятная ошибка, а не битый комментарий', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await expect(addComment('me', 'w1', 'текст')).rejects.toThrow('Не получилось — попробуй еще раз.')
    await expect(editComment('me', 'c1', 'текст')).rejects.toThrow('Не получилось — попробуй еще раз.')
  })
  it('правка возвращает только текст и метку правки', async () => {
    rpc.mockResolvedValue({ data: { ...ROW, body: 'Новое', edited_at: '2026-10-19T11:00:00Z', like_count: 3 }, error: null })
    expect(await editComment('me', 'c1', 'Новое')).toEqual({ body: 'Новое', edited_at: '2026-10-19T11:00:00Z' })
    expect(rpc).toHaveBeenLastCalledWith('comment_edit', { p_id: 'c1', p_body: 'Новое' })
  })
  it('реакция: comment_react с видом или null; ответ нормализован; удаление — true/false', async () => {
    rpc.mockResolvedValue({ data: [{ like_count: '2', liked: 1, reactions: { laugh: 2, poop: 1 }, my_reaction: 'laugh' }], error: null })
    expect(await reactComment('me', 'c1', 'laugh')).toEqual({ like_count: 2, liked: true, reactions: { laugh: 2 }, my_reaction: 'laugh' })
    expect(rpc).toHaveBeenLastCalledWith('comment_react', { p_id: 'c1', p_kind: 'laugh' })
    rpc.mockResolvedValue({ data: { like_count: -5, liked: null, reactions: null, my_reaction: 'x' }, error: null })
    expect(await reactComment('me', 'c1', 'poop')).toEqual({ like_count: 0, liked: false, reactions: {}, my_reaction: null })
    expect(rpc).toHaveBeenLastCalledWith('comment_react', { p_id: 'c1', p_kind: null })
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await deleteComment('me', 'c1')).toBe(false)
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await deleteComment('me', 'c1')).toBe(true)
  })
})
