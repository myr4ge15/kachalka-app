// @vitest-environment jsdom
// Админка → «Обращения»: фильтр открытых, скриншот по запросу, статус + ответ.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminFeedback from './AdminFeedback.jsx'
import { showToast } from './Toast.jsx'

vi.mock('./Toast.jsx', () => ({ showToast: vi.fn() }))
vi.mock('../lib/feedbackApi.js', () => ({
  FeedbackError: class FeedbackError extends Error {},
  adminListFeedback: vi.fn(), adminUpdateFeedback: vi.fn(), feedbackShotUrl: vi.fn(),
}))

const ROWS = [
  { id: 'a', author_name: 'Маша', body: 'Пропал подход', status: 'new', context: { version: '6.11.0', device: 'iPhone · iOS 17.5', standalone: true, screen: 'Профиль' }, screenshot_path: 'u/a.jpg', reply: null, created_at: '2026-10-05T10:00:00Z' },
  { id: 'b', author_name: 'Петя', body: 'Темная тема ярче', status: 'in_progress', context: {}, screenshot_path: null, reply: 'Посмотрю', replied_at: '2026-10-05T11:00:00Z', reply_seen_at: '2026-10-05T11:30:00Z', created_at: '2026-10-04T10:00:00Z' },
  { id: 'c', author_name: 'Аня', body: 'Старое', status: 'resolved', context: {}, screenshot_path: null, reply: 'Готово', replied_at: '2026-10-03T11:00:00Z', created_at: '2026-10-03T10:00:00Z' },
]

function setup(over = {}) {
  const api = {
    list: vi.fn(async () => ROWS),
    update: vi.fn(async () => ({ notified: true, pushed: 1 })),
    shot: vi.fn(async () => 'https://x.supabase.co/signed/a.jpg'),
    ...over,
  }
  render(<AdminFeedback online api={api} />)
  return api
}

beforeEach(() => vi.clearAllMocks())

describe('AdminFeedback', () => {
  it('по умолчанию открытые, «Все» показывает и закрытые; контекст строкой', async () => {
    setup()
    expect(await screen.findByText('Пропал подход')).toBeTruthy()
    expect(screen.getByText('Темная тема ярче')).toBeTruthy()
    expect(screen.queryByText('Старое')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Открытые · 2' })).toBeTruthy()
    expect(screen.getByText('v6.11.0 · iPhone · iOS 17.5 · PWA · экран: Профиль')).toBeTruthy()
    expect(screen.getByText(/· прочитан/)).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: 'Все · 3' }))
    expect(screen.getByText('Старое')).toBeTruthy()
  })

  it('скриншот грузится по нажатию (signed URL)', async () => {
    const api = setup()
    await userEvent.click(await screen.findByRole('button', { name: '📎 Показать скриншот' }))
    expect(api.shot).toHaveBeenCalledWith('u/a.jpg')
    expect(await screen.findByAltText('Скриншот от Маша')).toHaveAttribute('src', 'https://x.supabase.co/signed/a.jpg')
  })

  it('ответ + «Решено» → update, тост про уведомление, список перечитан', async () => {
    const api = setup()
    const card = (await screen.findByText('Пропал подход')).closest('li')
    await userEvent.click(within(card).getByRole('button', { name: 'Ответить / сменить статус' }))
    // Новое обращение при открытии редактора предлагает «В работе».
    expect(within(card).getByRole('radio', { name: 'В работе' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(card).getByRole('radio', { name: 'Решено' }))
    await userEvent.type(within(card).getByLabelText('Ответ автору (необязательно)'), 'Исправлено в 6.11.1')
    await userEvent.click(within(card).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', 'resolved', 'Исправлено в 6.11.1'))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'Автору отправлено уведомление.' }))
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  })

  it('существующий ответ подставлен в редактор; ошибка — тост, редактор остается', async () => {
    const api = setup({ update: vi.fn(async () => { throw new Error('Нужны права') }) })
    const card = (await screen.findByText('Темная тема ярче')).closest('li')
    await userEvent.click(within(card).getByRole('button', { name: 'Изменить ответ или статус' }))
    expect(within(card).getByLabelText('Ответ автору (необязательно)')).toHaveValue('Посмотрю')
    await userEvent.click(within(card).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не сохранилось' })))
    expect(within(card).getByRole('button', { name: 'Сохранить' })).toBeEnabled()
    expect(api.update).toHaveBeenCalledWith('b', 'in_progress', 'Посмотрю')
  })

  it('нет открытых — понятная пустая заглушка', async () => {
    setup({ list: vi.fn(async () => [ROWS[2]]) })
    expect(await screen.findByText('Открытых обращений нет 🎉')).toBeTruthy()
  })
})
