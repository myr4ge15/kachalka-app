// @vitest-environment jsdom
// «Написать разработчику»: отправка с контекстом, скриншот, свои обращения с ответом.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedbackScreen from './FeedbackScreen.jsx'
import { showToast } from '../components/Toast.jsx'
import { FeedbackError } from '../lib/feedbackApi.js'

const sync = vi.hoisted(() => ({ online: true }))
vi.mock('../db/sync.js', () => ({ useSyncStatus: () => sync }))
vi.mock('../components/Toast.jsx', () => ({ showToast: vi.fn() }))
vi.mock('../lib/feedbackApi.js', () => ({
  FeedbackError: class FeedbackError extends Error {},
  submitFeedback: vi.fn(), listMyFeedback: vi.fn(), ackMyFeedback: vi.fn(),
}))

const USER = { id: 'me', name: 'Маша' }
const ROW = {
  id: 'f1', body: 'Пропал подход', status: 'resolved', reply: 'Исправлено в 6.11.1',
  replied_at: '2026-10-05T12:00:00Z', reply_seen_at: null, has_screenshot: true, created_at: '2026-10-05T10:00:00Z',
}

function setup(over = {}) {
  const api = {
    submit: vi.fn(async () => ({ id: 'new', delivered: true })),
    list: vi.fn(async () => []),
    ack: vi.fn(),
    ...over,
  }
  render(<FeedbackScreen user={USER} onBack={() => {}} api={api} />)
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
  sync.online = true
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('FeedbackScreen', () => {
  it('отправка: текст + контекст (версия, устройство, экран), форма очищается', async () => {
    const api = setup()
    const send = screen.getByRole('button', { name: 'Отправить' })
    expect(send).toBeDisabled() // пусто — нечего отправлять
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'Пропал подход')
    await userEvent.click(send)
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    const [uid, payload] = api.submit.mock.calls[0]
    expect(uid).toBe('me')
    expect(payload.body).toBe('Пропал подход')
    expect(payload.file).toBeNull()
    expect(payload.context).toMatchObject({ screen: 'Профиль', standalone: false })
    expect(payload.context.version).toBeTruthy()
    expect(payload.context.device).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('Что случилось?')).toHaveValue(''))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Отправлено' }))
    expect(api.list).toHaveBeenCalledTimes(2) // при открытии и после отправки
  })

  it('скриншот: превью, отправка вместе с файлом, «Убрать»', async () => {
    const api = setup()
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('fb-file'), file)
    expect(await screen.findByAltText('Скриншот к обращению')).toHaveAttribute('src', 'blob:preview')
    await userEvent.click(screen.getByRole('button', { name: 'Убрать скриншот' }))
    expect(screen.queryByAltText('Скриншот к обращению')).toBeNull()
    await userEvent.upload(screen.getByTestId('fb-file'), file)
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'см. скрин')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(api.submit.mock.calls[0][1].file).toBe(file))
  })

  it('ошибка сервера — тост с текстом, введенное не теряется', async () => {
    const api = setup({ submit: vi.fn(async () => { throw new FeedbackError('Много обращений подряд.') }) })
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'идея')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'Много обращений подряд.' })))
    expect(screen.getByLabelText('Что случилось?')).toHaveValue('идея')
    expect(api.submit).toHaveBeenCalledTimes(1)
  })

  it('офлайн: отправка недоступна, с пояснением', async () => {
    sync.online = false
    const api = setup()
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'идея')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Нет связи')
    expect(api.list).not.toHaveBeenCalled()
  })

  it('свои обращения: статус, ответ с меткой «новый», ответ подтверждается прочитанным', async () => {
    const api = setup({ list: vi.fn(async () => [ROW]) })
    expect(await screen.findByText('Исправлено в 6.11.1')).toBeTruthy()
    expect(screen.getByText('Решено')).toBeTruthy()
    expect(screen.getByText('новый')).toBeTruthy()
    expect(screen.getByText('📎 со скриншотом')).toBeTruthy()
    expect(api.ack).toHaveBeenCalledTimes(1)
  })

  it('прочитанный ответ без метки и без повторного ack; пустой список', async () => {
    const api = setup({ list: vi.fn(async () => [{ ...ROW, reply_seen_at: '2026-10-05T13:00:00Z' }]) })
    expect(await screen.findByText('Исправлено в 6.11.1')).toBeTruthy()
    expect(screen.queryByText('новый')).toBeNull()
    expect(api.ack).not.toHaveBeenCalled()
  })
})
