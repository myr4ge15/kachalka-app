// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const postComment = vi.fn()
const removeComment = vi.fn()
vi.mock('../../db/comments.js', () => ({
  postComment: (...a) => postComment(...a),
  removeComment: (...a) => removeComment(...a),
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

beforeEach(() => { setOnline(true); postComment.mockReset(); removeComment.mockReset(); showToast.mockReset() })
afterEach(() => setOnline(true))

const renderThread = (props = {}) => render(
  <CommentThread workoutId="w1" ownerId="owner" comments={[]} me={me} open={false} onOpen={vi.fn()} {...props} />,
)

describe('CommentThread', () => {
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

  it('⋯ — у своих и у всех под своей тренировкой', () => {
    const { rerender } = renderThread({ open: true, comments: [c('a', 'x'), c('b', 'me')] })
    expect(screen.getAllByRole('button', { name: 'Удалить комментарий' })).toHaveLength(1)
    rerender(<CommentThread workoutId="w1" ownerId="me" comments={[c('a', 'x'), c('b', 'me')]} me={me} open onOpen={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Удалить комментарий' })).toHaveLength(2)
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

  it('удаление через подтверждение', async () => {
    removeComment.mockResolvedValue(undefined)
    renderThread({ open: true, comments: [c('a', 'me')] })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить комментарий' }))
    expect(screen.getByText(/Твой комментарий/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(screen.queryByText(/Твой комментарий/)).toBeNull())
    expect(removeComment).toHaveBeenCalledWith({ userId: 'me', comment: expect.objectContaining({ id: 'a' }), ownerId: 'owner' })
  })
})
