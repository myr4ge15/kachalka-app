// @vitest-environment jsdom
// Статус заявки «Запросить доступ» над входом (покрытие 26.10.2026: строки 55 %, функции 1/5 —
// худший файл проекта). Приняли — регистрация по токену; ждет — «Проверить» отвечает
// («Проверяю…» → «Пока без ответа»), отмена заявки — со второго тапа; отклонили — «Понятно».
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import JoinStatusCard from './JoinStatusCard.jsx'

const tap = (name) => fireEvent.click(screen.getByRole('button', { name, exact: true }))

describe('JoinStatusCard', () => {
  it('нет заявки и отказа — ничего не рисует', () => {
    const { container } = render(<JoinStatusCard pending={null} joinNote={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('приняли — «Зарегистрироваться» отдает токен, «Убрать» — забывает', () => {
    const onInvite = vi.fn()
    const onForget = vi.fn()
    render(<JoinStatusCard pending={{ token: 't-1', name: 'Петя' }} onInvite={onInvite} onForget={onForget} />)
    expect(screen.getByRole('status')).toHaveTextContent('Тебя приняли в круг')
    tap('Зарегистрироваться')
    expect(onInvite).toHaveBeenCalledWith('t-1')
    tap('Убрать')
    expect(onForget).toHaveBeenCalledTimes(1)
  })

  it('ждет ответа — имя в заявке; без имени строки нет', () => {
    const { rerender } = render(<JoinStatusCard pending={{ name: 'Петя' }} />)
    expect(screen.getByText('Имя в заявке: Петя')).toBeInTheDocument()
    rerender(<JoinStatusCard pending={{}} />)
    expect(screen.queryByText(/Имя в заявке/)).toBeNull()
  })

  it('«Проверить»: пока идет — «Проверяю…» и кнопка заблокирована, повторный тап не зовет; потом — «Пока без ответа»', async () => {
    let done
    const onCheck = vi.fn(() => new Promise((r) => { done = r }))
    render(<JoinStatusCard pending={{}} onCheck={onCheck} />)
    tap('Проверить')
    const busy = screen.getByRole('button', { name: 'Проверяю…' })
    expect(busy).toBeDisabled()
    fireEvent.click(busy)
    expect(onCheck).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Пока без ответа/)).toBeNull()
    await act(async () => done())
    expect(screen.getByText('Пока без ответа — загляни позже.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled()
  })

  it('«Проверить» без сети (ошибка) — тоже честный ответ, а не зависшая кнопка', async () => {
    render(<JoinStatusCard pending={{}} onCheck={vi.fn().mockRejectedValue(new Error('offline'))} />)
    await act(async () => tap('Проверить'))
    expect(screen.getByText('Пока без ответа — загляни позже.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled()
  })

  it('«Отменить заявку» — со второго тапа; «Оставить» возвращает как было', () => {
    const onForget = vi.fn()
    render(<JoinStatusCard pending={{}} onForget={onForget} />)
    tap('Отменить заявку')
    expect(onForget).not.toHaveBeenCalled()
    tap('Оставить')
    expect(screen.queryByRole('button', { name: 'Оставить' })).toBeNull()
    tap('Отменить заявку')
    tap('Отменить заявку')
    expect(onForget).toHaveBeenCalledTimes(1)
  })

  it('отклонили — «Понятно» убирает отметку', () => {
    const onClearNote = vi.fn()
    render(<JoinStatusCard pending={null} joinNote="declined" onClearNote={onClearNote} />)
    expect(screen.getByRole('status')).toHaveTextContent('Владелец пока не принял заявку.')
    tap('Понятно')
    expect(onClearNote).toHaveBeenCalledTimes(1)
  })
})
