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

  // Аудит 16.10 + fb_09a0e8d2: пока держишь реакцию — облачко с теми, кто поставил именно ее; отпустил — скрылось.
  it('удержание — облачко «🔥 Петя, Я», отпускание его скрывает, реакция не меняется', () => {
    vi.useFakeTimers()
    try {
      const onReact = vi.fn()
      render(<ReactionBar reactions={R} myId="me" isMe={false} onReact={onReact} />)
      const fire = screen.getByRole('button', { name: /🔥/ })
      fireEvent.pointerDown(fire, { clientX: 10, clientY: 10 })
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('status')).toHaveTextContent('🔥 Петя, Я')
      fireEvent.pointerMove(fire, { clientX: 10, clientY: 40 }) // палец дрогнул — облачко держится
      expect(screen.getByRole('status')).toBeInTheDocument()
      fireEvent.pointerUp(fire)
      fireEvent.click(fire)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(onReact).not.toHaveBeenCalled()
      expect(screen.getByText('Петя, Я, Вася')).toBeInTheDocument() // общий список на месте
      fireEvent.click(fire) // обычный тап снова ставит/снимает
      expect(onReact).toHaveBeenCalledWith('fire', true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('потерянное отпускание — облачко гаснет само', () => {
    vi.useFakeTimers()
    try {
      render(<ReactionBar reactions={R} myId="me" isMe={false} onReact={vi.fn()} />)
      fireEvent.pointerDown(screen.getByRole('button', { name: /💪/ }), { clientX: 10, clientY: 10 })
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('status')).toHaveTextContent('💪 Вася')
      act(() => { vi.advanceTimersByTime(6100) })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      fireEvent.pointerDown(fire, { clientX: 10, clientY: 10 })
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('status')).toHaveTextContent('🔥 Петя, Я')
    } finally {
      vi.useRealTimers()
    }
  })

  it('длинный список имен сворачивается в «+N»', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ user_id: id, name: id.toUpperCase(), kind: 'clap' }))
    render(<ReactionBar reactions={many} myId="me" isMe={false} />)
    expect(screen.getByText('A, B, C +2')).toBeInTheDocument()
  })
  it('💬 в конце ряда: счетчик, пометка своих, тап; на своей тренировке без реакций — тоже', () => {
    const onClick = vi.fn()
    const { rerender } = render(<ReactionBar reactions={R} myId="me" isMe={false} onReact={vi.fn()}
      comment={{ count: 3, mine: true, onClick }} />)
    const pill = screen.getByRole('button', { name: 'Комментарии: 3' })
    expect(pill).toHaveClass('cm-pill', 'mine')
    fireEvent.click(pill)
    expect(onClick).toHaveBeenCalled()
    rerender(<ReactionBar reactions={[]} myId="me" isMe comment={{ count: 0, mine: false, onClick }} />)
    expect(screen.getByRole('button', { name: 'Написать комментарий' })).toBeInTheDocument()
  })
})
