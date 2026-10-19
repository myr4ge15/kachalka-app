// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const postComment = vi.fn()
const removeComment = vi.fn()
const updateComment = vi.fn()
const setCommentLike = vi.fn()
vi.mock('../../db/comments.js', () => ({
  postComment: (...a) => postComment(...a),
  removeComment: (...a) => removeComment(...a),
  updateComment: (...a) => updateComment(...a),
  setCommentLike: (...a) => setCommentLike(...a),
}))
const showToast = vi.fn()
vi.mock('../ui/Toast.jsx', () => ({ showToast: (...a) => showToast(...a) }))

const { default: CommentThread } = await import('./CommentThread.jsx')

const me = { id: 'me', name: 'Илья' }
const c = (id, user_id, extra = {}) => ({
  id, workout_id: 'w1', user_id, name: user_id === 'me' ? 'Илья' : `Имя-${id}`, known: true,
  avatar_url: null, body: `текст ${id}`, created_at: new Date().toISOString(), ...extra,
})
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v })

beforeEach(() => {
  setOnline(true)
  for (const f of [postComment, removeComment, updateComment, setCommentLike, showToast]) f.mockReset()
})
afterEach(() => setOnline(true))

const renderThread = (props = {}) => render(
  <CommentThread workoutId="w1" ownerId="owner" comments={[]} me={me} open={false} onOpen={vi.fn()} {...props} />,
)

describe('CommentThread', () => {
  it('«Комментировать» при открытой ветке — только курсор, экран не центрирует (fb_17aad9f1)', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = renderThread({ comments: [c('a', 'x')] })
    rerender(<CommentThread workoutId="w1" ownerId="owner" comments={[c('a', 'x')]} me={me} open onOpen={vi.fn()} focusTick={1} />)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveFocus()
    rerender(<CommentThread workoutId="w1" ownerId="owner" comments={[c('a', 'x')]} me={me} open onOpen={vi.fn()} focusTick={2} />)
    expect(scroll).toHaveBeenCalledTimes(1)
    delete Element.prototype.scrollIntoView
  })

  it('пусто и свернуто — ничего не рисует', () => {
    const { container } = renderThread()
    expect(container).toBeEmptyDOMElement()
  })

  it('свернуто: два последних и «Все комментарии (N)»', () => {
    const onOpen = vi.fn()
    renderThread({ comments: [c('a', 'x'), c('b', 'y'), c('d', 'z')], onOpen })
    expect(screen.queryByText('текст a')).toBeNull()
    expect(screen.getByText('текст d')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Все комментарии (3)' }))
    expect(onOpen).toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('незнакомый автор — без перехода в профиль, знакомый — по тапу', () => {
    const onOpenMember = vi.fn()
    renderThread({ open: true, onOpenMember, comments: [c('a', 'x', { known: false, name: 'Сергей' }), c('b', 'y', { name: 'Дима' })] })
    expect(screen.queryByRole('button', { name: 'Сергей' })).toBeNull()
    expect(screen.getByText('Сергей')).toHaveClass('plain')
    fireEvent.click(screen.getByRole('button', { name: 'Дима' }))
    expect(onOpenMember).toHaveBeenCalledWith('y')
  })

  it('⋯ — меню: у своего «Изменить/Удалить», у чужого под своей тренировкой — только «Удалить», у чужого под чужой — нет', () => {
    const { rerender } = renderThread({ open: true, comments: [c('a', 'x'), c('b', 'me')] })
    expect(screen.getAllByRole('button', { name: 'Действия с комментарием' })).toHaveLength(1)
    rerender(<CommentThread workoutId="w1" ownerId="me" comments={[c('a', 'x'), c('b', 'me')]} me={me} open onOpen={vi.fn()} />)
    const [other, mine] = screen.getAllByRole('button', { name: 'Действия с комментарием' })
    fireEvent.click(other)
    expect(other).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent.trim())).toEqual(['Удалить'])
    fireEvent.click(mine)
    expect(other).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent.trim())).toEqual(['Изменить', 'Удалить'])
  })

  it('меню ⋯ закрывается тапом мимо и Esc', () => {
    renderThread({ open: true, comments: [c('a', 'me')] })
    const more = screen.getByRole('button', { name: 'Действия с комментарием' })
    fireEvent.click(more)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(more)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(more).toHaveFocus()
  })

  it('отправка: строка сразу, поле очищено; ошибка — текст вернулся и тост', async () => {
    let fail
    postComment.mockReturnValue(new Promise((_, rej) => { fail = rej }))
    renderThread({ open: true })
    const box = screen.getByRole('textbox', { name: 'Комментарий' })
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    fireEvent.change(box, { target: { value: '  в четверг жмем?  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(screen.getByText('в четверг жмем?').closest('.cm-item')).toHaveClass('pending')
    expect(box).toHaveValue('')
    expect(postComment).toHaveBeenCalledWith({ userId: 'me', workoutId: 'w1', ownerId: 'owner', text: 'в четверг жмем?' })
    await act(async () => { fail(new Error('Нет сети.')) })
    expect(box).toHaveValue('в четверг жмем?')
    expect(screen.queryByText('отправка…')).toBeNull()
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'Нет сети.' }))
  })

  it('счетчик знаков — только ближе к пределу', () => {
    renderThread({ open: true })
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'я'.repeat(10) } })
    expect(screen.queryByText(/\/ 500/)).toBeNull()
    fireEvent.change(box, { target: { value: 'я'.repeat(420) } })
    expect(screen.getByText('420 / 500')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'я'.repeat(501) } })
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  })

  it('без сети — только чтение', () => {
    setOnline(false)
    renderThread({ open: true, comments: [c('a', 'x')] })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Нет сети — комментарии только читать')
  })

  it('удаление своего: ⋯ → Удалить → подтверждение', async () => {
    removeComment.mockResolvedValue(undefined)
    renderThread({ open: true, comments: [c('a', 'me')] })
    fireEvent.click(screen.getByRole('button', { name: 'Действия с комментарием' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByText(/Твой комментарий/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(screen.queryByText(/Твой комментарий/)).toBeNull())
    expect(removeComment).toHaveBeenCalledWith({ userId: 'me', comment: expect.objectContaining({ id: 'a' }), ownerId: 'owner' })
  })

  it('правка своего: текст в поле, «Сохранить», сразу новый текст и «изменено»; ошибка — правка вернулась', async () => {
    let fail
    updateComment.mockReturnValue(new Promise((_, rej) => { fail = rej }))
    renderThread({ open: true, comments: [c('a', 'me')] })
    fireEvent.click(screen.getByRole('button', { name: 'Действия с комментарием' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    const box = screen.getByRole('textbox', { name: 'Комментарий' })
    expect(box).toHaveValue('текст a')
    expect(screen.getByText('Изменяешь комментарий')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'новый текст' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('новый текст')).toBeInTheDocument()
    expect(screen.getByText('· изменено')).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(updateComment).toHaveBeenCalledWith({ userId: 'me', comment: expect.objectContaining({ id: 'a' }), ownerId: 'owner', text: 'новый текст' })
    await act(async () => { fail(new Error('Нет сети.')) })
    expect(screen.getByText('текст a')).toBeInTheDocument()
    expect(box).toHaveValue('новый текст')
    expect(screen.getByText('Изменяешь комментарий')).toBeInTheDocument()
  })

  it('правка без изменений и отмена — сервер не трогаем', () => {
    renderThread({ open: true, comments: [c('a', 'me')] })
    fireEvent.click(screen.getByRole('button', { name: 'Действия с комментарием' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(updateComment).not.toHaveBeenCalled()
    expect(screen.queryByText('Изменяешь комментарий')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Действия с комментарием' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отменить правку' }))
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.queryByText('· изменено')).toBeNull()
  })

  it('метка «изменено» с сервера', () => {
    renderThread({ open: true, comments: [c('a', 'x', { edited_at: '2026-10-19T12:00:00Z' })] })
    expect(screen.getByText('· изменено')).toBeInTheDocument()
  })

  it('❤️: на чужой — сразу закрашено и +1; на своем — только счетчик; без сети — неактивно', async () => {
    let done
    setCommentLike.mockReturnValue(new Promise((res) => { done = res }))
    const { rerender } = renderThread({ open: true, comments: [c('a', 'x', { like_count: 2 }), c('b', 'me', { like_count: 1 })] })
    const btn = screen.getByRole('button', { name: 'Лайк' })
    expect(btn).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: 'Лайков: 1' })).toBeDisabled()
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Убрать лайк' })).toHaveTextContent('3')
    expect(setCommentLike).toHaveBeenCalledWith({ userId: 'me', comment: expect.objectContaining({ id: 'a' }), ownerId: 'owner', on: true })
    await act(async () => { done({ like_count: 3, liked: true }) })
    setOnline(false)
    rerender(<CommentThread workoutId="w1" ownerId="other" comments={[c('a', 'x', { like_count: 3, liked: true })]} me={me} open onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Убрать лайк' })).toHaveTextContent('3')
  })

  it('❤️ ошибка — откат и тост', async () => {
    setCommentLike.mockRejectedValue(new Error('Нет сети.'))
    renderThread({ open: true, comments: [c('a', 'x')] })
    fireEvent.click(screen.getByRole('button', { name: 'Лайк' }))
    await waitFor(() => expect(showToast).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Лайк' }).textContent).toBe('')
  })
})
