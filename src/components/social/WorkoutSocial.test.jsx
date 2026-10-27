// @vitest-environment jsdom
// Комментарии одной строкой (20.10.2026, fb_152f36fc): в карточке — одна строка с
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

  // fb_ad51c03b, fb_fbbf5381 (26.10.2026): поле внутри прокрутки ездило с перепиской («пружина» у края) и
  // на фокус iOS уводила переписку за экран. Теперь листается только .sheet-scroll, поле — в подвале под ней.
  it('в листе блок ввода — одним узлом в подвале листа, вне прокрутки переписки; без подписи «Видят все…»', () => {
    renderSocial()
    fireEvent.click(screen.getByRole('button', { name: '4 комментария' }))
    const sheet = screen.getByRole('dialog', { name: 'Комментарии' })
    const compose = sheet.querySelector('.cm-compose')
    const scroll = sheet.querySelector('.sheet-scroll')
    expect(compose).toContainElement(within(sheet).getByLabelText('Комментарий'))
    expect(scroll).not.toContainElement(compose)
    expect(compose.parentElement).toHaveClass('cm-foot')
    expect(scroll.nextElementSibling).toBe(compose.parentElement) // подвал — сразу под перепиской
    expect(within(scroll).getByText('последний')).toBeInTheDocument()
    expect(within(sheet).queryByText(/Видят все/)).toBeNull()
  })

  it('без сети плашка «только читать» — тоже в подвале, а не в прокрутке', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    renderSocial()
    fireEvent.click(screen.getByRole('button', { name: '4 комментария' }))
    const sheet = screen.getByRole('dialog', { name: 'Комментарии' })
    expect(within(sheet).queryByLabelText('Комментарий')).toBeNull()
    expect(sheet.querySelector('.cm-foot')).toHaveTextContent('Нет сети — комментарии только читать')
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

  it('уведомление о комментарии — лист открыт на нем: подсвечен и по центру прокрутки (fb_2277554b)', () => {
    const rects = new Map()
    const orig = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      return rects.get(this.className.split(' ')[0]) ?? rects.get(this.dataset?.cm) ?? orig.call(this)
    }
    rects.set('sheet-scroll', { top: 100, height: 400 })
    rects.set('c2', { top: 900, height: 60 })
    try {
      renderSocial({ openThread: true, focusCommentId: 'c2' })
      const sheet = screen.getByRole('dialog', { name: 'Комментарии' })
      const item = sheet.querySelector('[data-cm="c2"]')
      expect(item).toHaveClass('cm-item--focus')
      expect(sheet.querySelectorAll('.cm-item--focus')).toHaveLength(1)
      // 900 − 100 = 800 от верха прокрутки, минус (400 − 60) / 2 — пузырь по центру.
      expect(item.closest('.sheet-scroll').scrollTop).toBe(630)
    } finally {
      Element.prototype.getBoundingClientRect = orig
    }
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

// Режим админа «Видеть всех» (27.10.2026): тренировка человека вне круга — только просмотр.
describe('WorkoutSocial — только просмотр', () => {
  it('реакции без кнопок, в ветке нет поля, ответа и реакций — подпись «Режим просмотра»', () => {
    const w = { ...workout(COMMENTS), reactions: [{ user_id: 'u1', user_name: 'Маша', kind: 'fire' }] }
    const { container } = render(<WorkoutSocial workout={w} me={me} isMe={false} onReact={vi.fn()} readOnly />)
    expect(container.querySelector('.reaction-btn:not(.static)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '4 комментария' }))
    const sheet = screen.getByRole('dialog', { name: 'Комментарии' })
    expect(within(sheet).queryByLabelText('Комментарий')).toBeNull()
    expect(within(sheet).getByText('Режим просмотра — писать и отвечать нельзя')).toBeInTheDocument()
    expect(sheet.querySelector('.cm-swipe-ico')).toBeNull()
  })

  it('без комментариев строки «Оставить комментарий» нет', () => {
    render(<WorkoutSocial workout={workout([])} me={me} isMe={false} onReact={vi.fn()} readOnly />)
    expect(screen.queryByRole('button', { name: 'Оставить комментарий' })).toBeNull()
  })
})
