// @vitest-environment jsdom
// Новый PIN по ссылке из бота (П1, v6.18.0).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ResetPinScreen from './ResetPinScreen.jsx'
import * as auth from '../lib/auth.js'

vi.mock('../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  return { checkPinReset: vi.fn(), applyPinReset: vi.fn(), LoginError }
})
const T = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'
afterEach(() => vi.clearAllMocks())

function fill(pin = '4826', pin2 = pin) {
  fireEvent.change(screen.getByLabelText('Новый PIN — 4 цифры'), { target: { value: pin } })
  fireEvent.change(screen.getByLabelText('Новый PIN еще раз'), { target: { value: pin2 } })
}

describe('ResetPinScreen', () => {
  it('живая ссылка → новый PIN → вход', async () => {
    vi.mocked(auth.checkPinReset).mockResolvedValue('ok')
    const user = { id: 'u7', name: 'Маша', role: 'member' }
    vi.mocked(auth.applyPinReset).mockResolvedValue(user)
    const onDone = vi.fn()
    render(<ResetPinScreen token={T} onDone={onDone} onCancel={vi.fn()} />)
    await screen.findByLabelText('Новый PIN — 4 цифры')
    fill('0000')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить PIN и войти' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком простой')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить PIN и войти' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(user))
    expect(auth.applyPinReset).toHaveBeenCalledWith(T, '4826')
  })

  it('мертвая ссылка — сразу; умерла при отправке — тот же текст', async () => {
    vi.mocked(auth.checkPinReset).mockResolvedValueOnce('invalid')
    const { unmount } = render(<ResetPinScreen token={T} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('устарела')
    unmount()
    vi.mocked(auth.checkPinReset).mockResolvedValueOnce('ok')
    vi.mocked(auth.applyPinReset).mockRejectedValue(new auth.LoginError('expired', 'expired'))
    render(<ResetPinScreen token={T} onDone={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Новый PIN — 4 цифры')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить PIN и войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('устарела')
  })

  it('на устройстве открыта учетка — сначала выйти, ссылку не проверяем', async () => {
    const onSignOut = vi.fn()
    render(<ResetPinScreen token={T} signedInAs="Дима" onDone={vi.fn()} onCancel={vi.fn()} onSignOut={onSignOut} />)
    expect(screen.getByText('Дима')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Выйти и продолжить' }))
    expect(onSignOut).toHaveBeenCalled()
    expect(auth.checkPinReset).not.toHaveBeenCalled()
  })
})
