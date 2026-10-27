// @vitest-environment jsdom
// Плашка «Видно всех» (27.10.2026): остаток и «Выключить»; ошибка — тост, кнопка снова доступна.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
const api = vi.hoisted(() => ({ disable: vi.fn(), toast: vi.fn() }))
vi.mock('../../db/adminViewAll.js', () => ({ disableViewAll: (...a) => api.disable(...a) }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: (...a) => api.toast(...a) }))
import ViewAllBanner from './ViewAllBanner.jsx'

const until = () => new Date(Date.now() + 90 * 60000 - 1000).toISOString()
beforeEach(() => { api.disable.mockReset(); api.toast.mockReset() })
afterEach(() => vi.clearAllMocks())

describe('ViewAllBanner', () => {
  it('остаток и выключение', async () => {
    render(<ViewAllBanner userId="me" until={until()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Наблюдатель · еще 1 ч 30 мин')
    fireEvent.click(screen.getByRole('button', { name: 'Выключить' }))
    await waitFor(() => expect(api.disable).toHaveBeenCalledWith('me'))
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'eyeoff' }))
  })

  it('не выключилось — тост, кнопка снова доступна', async () => {
    api.disable.mockRejectedValue(new Error('Нет сети'))
    render(<ViewAllBanner userId="me" until={until()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выключить' }))
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'alert', sub: 'Нет сети' })))
    expect(screen.getByRole('button', { name: 'Выключить' })).not.toBeDisabled()
  })
})
