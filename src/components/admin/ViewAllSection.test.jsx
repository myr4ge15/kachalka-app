// @vitest-environment jsdom
// Раздел Админки «Видеть всех» (27.10.2026): две кнопки срока, «Выключить» с остатком, офлайн — неактивно, ошибка — тостом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
const api = vi.hoisted(() => ({ state: null, enable: vi.fn(), disable: vi.fn(), toast: vi.fn() }))
vi.mock('../../hooks/useViewAll.js', () => ({ useViewAll: () => api.state }))
vi.mock('../../db/adminViewAll.js', () => ({
  enableViewAll: (...a) => api.enable(...a), disableViewAll: (...a) => api.disable(...a),
}))
vi.mock('../ui/Toast.jsx', () => ({ showToast: (...a) => api.toast(...a) }))
import ViewAllSection from './ViewAllSection.jsx'

beforeEach(() => { api.state = null; for (const f of [api.enable, api.disable, api.toast]) f.mockReset() })
afterEach(() => vi.clearAllMocks())

describe('ViewAllSection', () => {
  it('режима нет — «На 30 минут» и «На 2 часа»; тап включает на свой срок', async () => {
    render(<ViewAllSection userId="me" online />)
    fireEvent.click(screen.getByRole('button', { name: /На 2 часа/ }))
    await waitFor(() => expect(api.enable).toHaveBeenCalledWith('me', 120))
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'eye', title: 'Видно всех' }))
    fireEvent.click(screen.getByRole('button', { name: /На 30 минут/ }))
    await waitFor(() => expect(api.enable).toHaveBeenCalledWith('me', 30))
  })

  it('режим идет — «Выключить» с остатком', async () => {
    api.state = { until: new Date(Date.now() + 23 * 60000 - 1000).toISOString(), extra: [] }
    render(<ViewAllSection userId="me" online />)
    const off = screen.getByRole('button', { name: /Выключить/ })
    expect(off).toHaveTextContent('осталось 23 мин')
    expect(screen.queryByRole('button', { name: /На 30 минут/ })).toBeNull()
    fireEvent.click(off)
    await waitFor(() => expect(api.disable).toHaveBeenCalledWith('me'))
  })

  it('офлайн — кнопки неактивны и подписаны', () => {
    render(<ViewAllSection userId="me" online={false} />)
    const b = screen.getByRole('button', { name: /На 30 минут/ })
    expect(b).toBeDisabled()
    expect(b).toHaveTextContent('Нет сети')
  })

  it('ошибка — тост с текстом сервера', async () => {
    api.enable.mockRejectedValue(new Error('Нужен код 2FA'))
    render(<ViewAllSection userId="me" online />)
    fireEvent.click(screen.getByRole('button', { name: /На 30 минут/ }))
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'alert', sub: 'Нужен код 2FA' })))
  })
})
