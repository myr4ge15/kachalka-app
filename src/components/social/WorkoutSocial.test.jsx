// @vitest-environment jsdom
// Комментарии «как в Telegram» (20.10.2026, fb_152f36fc): в карточке — одна строка с
// аватарками последних комментаторов и счетчиком; ветка — листом во весь экран.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import WorkoutSocial, { lastCommenters } from './WorkoutSocial.jsx'

vi.mock('../../db/comments.js', () => ({
  postComment: vi.fn(), removeComment: vi.fn(), setCommentLike: vi.fn(), updateComment: vi.fn(),
}))

const me = { id: 'me', name: 'Сега' }
const c = (id, user_id, name, body = 'текст') => ({
  id, workout_id: 'w1', user_id, name, known: true, avatar_url: null, body, created_at: '2026-10-19T10:00:00Z', like_count: 0, liked: false,
})
const COMMENTS = [c('c1', 'u1', 'Маша', 'первый'), c('c2', 'u2', 'Дима'), c('c3', 'u1', 'Маша'), c('c4', 'u3', 'Петя', 'последний')]
const workout = (comments) => ({ id: 'w1', user_id: 'owner', reactions: [], comments })

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.clearAllMocks())

const renderSocial = (props = {}) =>
  render(<WorkoutSocial workout={workout(COMMENTS)} me={me} isMe={false} onReact={vi.fn()} {...props} />)

describe('WorkoutSocial — строка комментариев', () => {
  it('в карточке — только строка: счетчик и аватарки, текстов комментариев нет', () => {
    const { container } = renderSocial()
    expect(screen.getByRole('button', { name: '4 комментария' })).toBeInTheDocument()
    expect(container.querySelectorAll('.cm-strip-avs .avatar-sm')).toHaveLength(3)
    expect(screen.queryByText('последний')).toBeNull()
    expect(screen.queryByRole('button', { name: /Комментировать/ })).toBeNull() // кнопки в ряду реакций больше нет
  })

  it('последние разные комментаторы, свежий первым, не больше трех', () => {
    expect(lastCommenters(COMMENTS).map((x) => x.name)).toEqual(['Петя', 'Маша', 'Дима'])
    expect(lastCommenters([])).toEqual([])
    expect(lastCommenters(COMMENTS, 2).map((x) => x.name)).toEqual(['Петя', 'Маша'])
  })

  it('тап — лист «Комментарии» со всеми и полем; «закрыть» — назад к карточке', () => {
    renderSocial()
    fireEvent.click(screen.getByRole('button', { name: '4 комментария' }))
    const sheet = screen.getByRole('dialog', { name: 'Комментарии' })
    expect(within(sheet).getByText('первый')).toBeInTheDocument()
    expect(within(sheet).getByText('последний')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Комментарий')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'закрыть' }))
    expect(screen.queryByRole('dialog', { name: 'Комментарии' })).toBeNull()
  })

  it('в листе блок ввода — одним узлом внизу ветки (его прижимает CSS), без подписи «Видят все…»', () => {
    renderSocial()
    fireEvent.click(screen.getByRole('button', { name: '4 комментария' }))
    const sheet = screen.getByRole('dialog', { name: 'Комментарии' })
    const compose = sheet.querySelector('.cm-compose')
    expect(compose).toContainElement(within(sheet).getByLabelText('Комментарий'))
    expect(compose.parentElement.lastElementChild).toBe(compose) // после всех комментариев
    expect(within(sheet).queryByText(/Видят все/)).toBeNull()
  })

  it('комментариев нет — «Оставить комментарий», лист сразу с курсором в поле', () => {
    render(<WorkoutSocial workout={workout([])} me={me} isMe={false} onReact={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Оставить комментарий' }))
    expect(screen.getByLabelText('Комментарий')).toHaveFocus()
  })

  it('пуш о комментарии — лист открыт сразу', () => {
    renderSocial({ openThread: true })
    expect(screen.getByRole('dialog', { name: 'Комментарии' })).toBeInTheDocument()
  })

  it('имя комментатора в листе — профиль, лист закрывается', () => {
    const onOpenMember = vi.fn()
    renderSocial({ onOpenMember })
    fireEvent.click(screen.getByRole('button', { name: '4 комментария' }))
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Петя' })[0])
    expect(onOpenMember).toHaveBeenCalledWith('u3')
    expect(screen.queryByRole('dialog', { name: 'Комментарии' })).toBeNull()
  })
})
