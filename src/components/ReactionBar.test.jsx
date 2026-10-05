// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ReactionBar from './ReactionBar.jsx'

const R = [
  { user_id: 'a', name: 'Петя', kind: 'fire' },
  { user_id: 'me', name: 'Я', kind: 'fire' },
  { user_id: 'b', name: 'Вася', kind: 'muscle' },
]

describe('ReactionBar', () => {
  it('чужая тренировка: все 4 кнопки, счетчики и пометка своей реакции', () => {
    render(<ReactionBar reactions={R} myId="me" isMe={false} onReact={vi.fn()} />)
    const btns = screen.getAllByRole('button')
    expect(btns).toHaveLength(4)
    const fire = screen.getByRole('button', { name: /🔥/ })
    expect(fire).toHaveAttribute('aria-pressed', 'true')
    expect(fire).toHaveAttribute('title', 'Убрать реакцию')
    expect(fire).toHaveTextContent('2')
    const clap = screen.getByRole('button', { name: /👏/ })
    expect(clap).toHaveAttribute('aria-pressed', 'false')
    expect(clap.querySelector('.reaction-count')).toBeNull() // ноль не рисуем
    expect(screen.getByText('Петя, Я, Вася')).toBeInTheDocument()
  })

  it('тап передает вид и признак «моя» (снять/поставить)', () => {
    const onReact = vi.fn()
    render(<ReactionBar reactions={R} myId="me" isMe={false} onReact={onReact} />)
    fireEvent.click(screen.getByRole('button', { name: /🔥/ }))
    fireEvent.click(screen.getByRole('button', { name: /😮/ }))
    expect(onReact.mock.calls).toEqual([['fire', true], ['wow', false]])
  })

  it('без onReact тап не падает', () => {
    render(<ReactionBar reactions={[]} myId="me" isMe={false} />)
    expect(() => fireEvent.click(screen.getAllByRole('button')[0])).not.toThrow()
  })

  it('своя тренировка: без кнопок (самолайк запрещен), только ненулевые виды и имена', () => {
    const { container } = render(<ReactionBar reactions={R} myId="me" isMe onReact={vi.fn()} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelectorAll('.reaction-btn.static')).toHaveLength(2)
    expect(screen.getByText('Петя, Я, Вася')).toBeInTheDocument()
  })

  it('своя тренировка без реакций — ничего', () => {
    const { container } = render(<ReactionBar reactions={[]} myId="me" isMe />)
    expect(container).toBeEmptyDOMElement()
  })

  it('длинный список имен сворачивается в «+N»', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ user_id: id, name: id.toUpperCase(), kind: 'clap' }))
    render(<ReactionBar reactions={many} myId="me" isMe={false} />)
    expect(screen.getByText('A, B, C +2')).toBeInTheDocument()
  })
})
