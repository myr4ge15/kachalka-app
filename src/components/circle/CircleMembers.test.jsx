// @vitest-environment jsdom
import { describe, it, vi, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CircleMembers from './CircleMembers.jsx'
vi.mock('../../hooks/usePresence.js', () => ({ usePresence: () => new Map() }))
vi.mock('../friends/FriendButton.jsx', () => ({ default: () => <button>В друзья</button> }))
const rows = [{ user_id: 'me', name: 'Я', is_owner: true, status: 'active' }, { user_id: 'other', name: 'Друг', status: 'active' }]
describe('участники как друзья', () => {
  it('строка открывает профиль, опасные действия скрыты в меню и требуют подтверждения', async () => {
    const api = { members: vi.fn(async () => rows), remove: vi.fn(async () => {}) }
    const open = vi.fn()
    render(<CircleMembers api={api} circle={{ circle_id: 'c', is_owner: true }} me="me" onOpenMember={open} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Друг' }))
    expect(open).toHaveBeenCalledWith('other')
    expect(screen.queryByRole('button', { name: 'Убрать' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Действия: Друг' }))
    await userEvent.click(screen.getByRole('button', { name: 'Убрать' }))
    expect(api.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Точно убрать?' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('c', 'other'))
  })
  it('участнику не показываются действия владельца', async () => {
    render(<CircleMembers api={{ members: async () => rows }} circle={{ circle_id: 'c', is_owner: false }} me="other" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Действия: Я' }))
    expect(screen.queryByRole('button', { name: 'Передать круг' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Убрать' })).toBeNull()
  })
})
