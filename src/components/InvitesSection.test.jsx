// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InvitesSection from './InvitesSection.jsx'
import { showToast } from './Toast.jsx'

// Админский режим (limit=null) напрямую; режим участника с лимитом покрыт в
// MemberInvites.test. api — инъекция, сеть не нужна.
vi.mock('../lib/admin.js', () => ({ adminCreateInvite: vi.fn(), adminListInvites: vi.fn(), adminRevokeInvite: vi.fn() }))
vi.mock('./Toast.jsx', () => ({ showToast: vi.fn() }))

const TOKEN = 'x'.repeat(43)
const errMsg = (e) => e.message
let api
beforeEach(() => {
  vi.clearAllMocks()
  api = { list: vi.fn().mockResolvedValue([]), create: vi.fn(), revoke: vi.fn().mockResolvedValue() }
})
const renderSec = (props = {}) => render(<InvitesSection online errMsg={errMsg} api={api} {...props} />)

describe('InvitesSection (админка)', () => {
  it('создает ссылку с пометкой, показывает ее один раз; «Готово» прячет', async () => {
    api.create.mockResolvedValue({ id: 'i1', token: TOKEN, expires_at: '2026-10-12T00:00:00Z' })
    renderSec()
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByPlaceholderText('напр. Саша с работы'), { target: { value: '  Саша ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }))
    const url = await screen.findByLabelText('Ссылка-приглашение')
    expect(url.value).toContain(`#invite=${TOKEN}`)
    expect(api.create).toHaveBeenCalledWith('  Саша ')
    expect(screen.getByText('Ссылка · Саша')).toBeInTheDocument()
    expect(api.list).toHaveBeenCalledTimes(2) // список перечитан
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.queryByLabelText('Ссылка-приглашение')).toBeNull()
    expect(screen.getByPlaceholderText('напр. Саша с работы')).toHaveValue('') // пометка сброшена
  })

  it('копирование кладет текст приглашения в буфер; сбой буфера — тост с подсказкой', async () => {
    api.create.mockResolvedValue({ id: 'i1', token: TOKEN, expires_at: '2026-10-12T00:00:00Z' })
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderSec()
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }))
    await screen.findByLabelText('Ссылка-приглашение')
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`#invite=${TOKEN}`)))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Приглашение скопировано' })))
    writeText.mockRejectedValue(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Не скопировалось' })))
  })

  it('«Поделиться» отдает текст приглашения со ссылкой внутри, без отдельного url (v6.16.1)', async () => {
    api.create.mockResolvedValue({ id: 'i1', token: TOKEN, expires_at: '2026-10-12T00:00:00Z' })
    const share = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    try {
      renderSec()
      fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }))
      await screen.findByLabelText('Ссылка-приглашение')
      fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }))
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
      const arg = share.mock.calls[0][0]
      expect(arg.url).toBeUndefined()
      expect(arg.text).toContain('Зову тебя')
      expect(arg.text).toContain(`#invite=${TOKEN}`)
    } finally {
      delete navigator.share
    }
  })

  it('ошибка создания — тост, кнопка снова активна', async () => {
    api.create.mockRejectedValue(new Error('Нет прав'))
    renderSec()
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ emoji: '⚠️', title: 'Не удалось', sub: 'Нет прав' }))
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeEnabled()
  })

  it('список: пометка, создатель (только в админке), отзыв активной ссылки', async () => {
    api.list.mockResolvedValue([
      { id: 'a', status: 'ok', note: 'Саша', expires_at: '2026-10-12T00:00:00Z', created_by_name: 'Админ' },
      { id: 'b', status: 'used', note: '', expires_at: '2026-10-01T00:00:00Z' },
    ])
    renderSec()
    expect(await screen.findByText('Саша')).toBeInTheDocument()
    expect(screen.getByText('Без пометки')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Отозвать ссылку' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать ссылку' }))
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ emoji: '⛔', title: 'Ссылка отозвана' }))
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('ошибка загрузки списка — alert и «Повторить»', async () => {
    api.list.mockRejectedValueOnce(new Error('Сеть упала')).mockResolvedValue([])
    renderSec()
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеть упала')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('офлайн: к серверу не ходит, создать нельзя', () => {
    renderSec({ online: false })
    expect(screen.getByRole('status')).toHaveTextContent('нужен интернет')
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeDisabled()
    expect(api.list).not.toHaveBeenCalled()
  })
})
