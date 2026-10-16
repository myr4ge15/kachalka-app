// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
    expect(fire).toHaveAttribute('title', 'Убрать реакцию (удержи — кто поставил)')
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

  // Аудит 16.10: удержание реакции показывает, кто поставил именно ее; тап после удержания не реагирует.
  it('удержание кнопки — строка «🔥 Петя, Я», реакция не меняется; через 4 с — снова общий список', () => {
    vi.useFakeTimers()
    try {
      const onReact = vi.fn()
      render(<ReactionBar reactions={R} myId="me" isMe={false} onReact={onReact} />)
      const fire = screen.getByRole('button', { name: /🔥/ })
      fireEvent.pointerDown(fire, { clientX: 10, clientY: 10 })
      act(() => { vi.advanceTimersByTime(500) })
      fireEvent.pointerUp(fire)
      fireEvent.click(fire)
      expect(screen.getByText('🔥 Петя, Я')).toBeInTheDocument()
      expect(onReact).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(4100) })
      expect(screen.getByText('Петя, Я, Вася')).toBeInTheDocument()
      fireEvent.click(fire) // обычный тап снова ставит/снимает
      expect(onReact).toHaveBeenCalledWith('fire', true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('сдвиг пальца — прокрутка, а не удержание; своя тренировка тоже показывает, кто поставил', () => {
    vi.useFakeTimers()
    try {
      render(<ReactionBar reactions={R} myId="x" isMe />)
      const fire = screen.getByText('🔥').closest('.reaction-btn')
      fireEvent.pointerDown(fire, { clientX: 10, clientY: 10 })
      fireEvent.pointerMove(fire, { clientX: 10, clientY: 40 })
      act(() => { vi.advanceTimersByTime(600) })
      expect(screen.queryByText('🔥 Петя, Я')).not.toBeInTheDocument()
      fireEvent.pointerDown(fire, { clientX: 10, clientY: 10 })
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('🔥 Петя, Я')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('длинный список имен сворачивается в «+N»', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ user_id: id, name: id.toUpperCase(), kind: 'clap' }))
    render(<ReactionBar reactions={many} myId="me" isMe={false} />)
    expect(screen.getByText('A, B, C +2')).toBeInTheDocument()
  })
})
