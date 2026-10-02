// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MemberInvites from './MemberInvites.jsx'

const mocks = vi.hoisted(() => ({ online: true, list: vi.fn(), create: vi.fn(), revoke: vi.fn() }))
vi.mock('../db/sync.js', () => ({ useSyncStatus: () => ({ online: mocks.online }) }))
vi.mock('../lib/memberInvites.js', () => ({ memberInviteApi: () => mocks }))
vi.mock('../lib/admin.js', () => ({ adminCreateInvite: vi.fn(), adminListInvites: vi.fn(), adminRevokeInvite: vi.fn() }))
vi.mock('./Toast.jsx', () => ({ showToast: vi.fn() }))

beforeEach(() => { vi.clearAllMocks(); mocks.online = true; mocks.list.mockResolvedValue([]) })
async function open() {
  render(<MemberInvites userId="member" />)
  fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalled())
}
describe('приглашения участника', () => {
  it('создаёт ссылку и показывает её для отправки', async () => {
    mocks.create.mockResolvedValue({ id: '1', token: 'x'.repeat(43), expires_at: '2026-10-09' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }))
    expect((await screen.findByLabelText('Ссылка-приглашение')).value).toContain('#invite=')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeVisible()
  })
  it('три активные ссылки блокируют создание, отзыв освобождает место', async () => {
    mocks.list.mockResolvedValue([1, 2, 3].map(id => ({ id, status: 'ok', expires_at: '2026-10-09' })))
    await open()
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeDisabled()
    mocks.list.mockResolvedValue([])
    mocks.revoke.mockResolvedValue()
    fireEvent.click(screen.getAllByRole('button', { name: 'Отозвать ссылку' })[0])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeEnabled())
    expect(mocks.revoke).toHaveBeenCalledWith(1)
  })
  it('офлайн объясняет недоступность и не обращается к серверу', () => {
    mocks.online = false
    render(<MemberInvites userId="member" />)
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить участника' }))
    expect(screen.getByRole('status')).toHaveTextContent('нужен интернет')
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeDisabled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('ошибка списка не разрешает создать четвёртую ссылку', async () => {
    mocks.list.mockRejectedValue(new Error('Нет связи'))
    await open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeDisabled()
  })
})
