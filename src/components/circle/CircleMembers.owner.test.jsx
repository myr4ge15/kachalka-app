// @vitest-environment jsdom
// Участники круга глазами владельца (покрытие тестами 20.10.2026: было 79 % строк): заявки
// «Хотят в круг» (кто привел, принять/нет), передача круга — со второго нажатия и с отказом,
// если у человека свой круг; ошибки загрузки и действий — текстом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CircleMembers from './CircleMembers.jsx'

vi.mock('../../hooks/usePresence.js', () => ({ usePresence: () => new Map(), useRosterSex: () => new Map() }))
vi.mock('../friends/FriendButton.jsx', () => ({ default: () => null }))

const ROWS = [
  { user_id: 'me', name: 'Я', is_owner: true, status: 'active' },
  { user_id: 'u2', name: 'Маша', status: 'active', invited_by_name: 'Я' },
  { user_id: 'u3', name: 'Петя', status: 'pending', invited_by_name: 'Маша' },
]
let api
beforeEach(() => {
  api = {
    members: vi.fn(async () => ROWS),
    decide: vi.fn(async () => 'ok'),
    transfer: vi.fn(async () => 'ok'),
    remove: vi.fn(async () => 'ok'),
  }
})
afterEach(() => vi.clearAllMocks())

const renderOwner = (props = {}) => render(<CircleMembers api={api} circle={{ circle_id: 'c1', is_owner: true }} me="me" {...props} />)

describe('CircleMembers — владелец', () => {
  it('заявки: кто привел; «Принять» и «Нет» → решение, список перечитан, onChanged', async () => {
    const onChanged = vi.fn()
    renderOwner({ onChanged })
    expect(await screen.findByText('Хотят в круг')).toBeInTheDocument()
    expect(screen.getByText('по коду Маша')).toBeInTheDocument()
    expect(screen.getByText(/Участники · 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }))
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('c1', 'u3', true))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(api.members).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }))
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('c1', 'u3', false))
  })

  it('передать круг — со второго нажатия; у человека свой круг — понятный отказ', async () => {
    api.transfer.mockResolvedValueOnce('has_own')
    renderOwner()
    fireEvent.click(await screen.findByRole('button', { name: 'Действия: Маша' }))
    expect(screen.getByText('Пришел(а) по коду Я')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Передать круг' }))
    expect(api.transfer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Точно передать?' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('У Маша уже есть свой круг — передать нельзя.')
  })

  it('«Открыть профиль» из меню', async () => {
    const onOpenMember = vi.fn()
    renderOwner({ onOpenMember })
    fireEvent.click(await screen.findByRole('button', { name: 'Действия: Маша' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть профиль' }))
    expect(onOpenMember).toHaveBeenCalledWith('u2')
  })

  it('список не загрузился — текст ошибки вместо «Загружаю…»', async () => {
    api.members.mockRejectedValue(new Error('Нет доступа — ты не в этом круге или не его владелец.'))
    renderOwner()
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('участнику заявки не показываются', async () => {
    render(<CircleMembers api={api} circle={{ circle_id: 'c1', is_owner: false }} me="u2" />)
    await screen.findByText('Маша')
    expect(screen.queryByText('Хотят в круг')).toBeNull()
  })
})
