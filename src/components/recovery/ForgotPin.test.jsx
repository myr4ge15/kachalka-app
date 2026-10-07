// @vitest-environment jsdom
// «Забыл PIN» (П1, v6.18.0): ссылка в Telegram и код восстановления.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ForgotPin from './ForgotPin.jsx'
import * as auth from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message, retryAfter = null) { super(message); this.code = code; this.retryAfter = retryAfter }
  }
  return { requestPinReset: vi.fn(), resetPinByCode: vi.fn(), createRecoveryCode: vi.fn(), LoginError }
})

const USER = { id: 'u7', name: 'Маша', role: 'member' }
beforeEach(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }))
afterEach(() => vi.clearAllMocks())

function fillCode({ login = 'masha', code = 'abcd efgh jkmn pqrs', pin = '4826', pin2 = '4826' } = {}) {
  fireEvent.change(screen.getByLabelText('Логин'), { target: { value: login } })
  fireEvent.change(screen.getByLabelText('Код восстановления'), { target: { value: code } })
  fireEvent.change(screen.getByLabelText('Новый PIN — 4 цифры'), { target: { value: pin } })
  fireEvent.change(screen.getByLabelText('Новый PIN еще раз'), { target: { value: pin2 } })
}

describe('ForgotPin', () => {
  it('Telegram: без логина — подсказка; лимит — сколько ждать', async () => {
    render(<ForgotPin onBack={vi.fn()} onLogin={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Прислать ссылку в Telegram' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Напиши логин')
    vi.mocked(auth.requestPinReset).mockRejectedValue(new auth.LoginError('locked', 'x', 600))
    fireEvent.change(screen.getByLabelText('Логин'), { target: { value: 'masha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Прислать ссылку в Telegram' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('через 10 мин')
  })

  it('код: проверка формы до сети', async () => {
    render(<ForgotPin onBack={vi.fn()} onLogin={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Нет Telegram? Восстановить кодом' }))
    fillCode({ code: 'abc' })
    fireEvent.click(screen.getByRole('button', { name: 'Сменить PIN и войти' }))
    expect(screen.getByRole('alert')).toHaveTextContent('16 знаков')
    fillCode({ pin: '1234', pin2: '1234' })
    fireEvent.click(screen.getByRole('button', { name: 'Сменить PIN и войти' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком простой')
    fillCode({ pin2: '4827' })
    fireEvent.click(screen.getByRole('button', { name: 'Сменить PIN и войти' }))
    expect(screen.getByRole('alert')).toHaveTextContent('не совпадают')
    expect(auth.resetPinByCode).not.toHaveBeenCalled()
  })

  it('код подошел → новый код один раз → вход', async () => {
    vi.mocked(auth.resetPinByCode).mockResolvedValue(USER)
    vi.mocked(auth.createRecoveryCode).mockResolvedValue('ZZZZ-YYYY-XXXX-WWWW')
    const onLogin = vi.fn()
    render(<ForgotPin initialLogin="masha" onBack={vi.fn()} onLogin={onLogin} />)
    fireEvent.click(screen.getByRole('button', { name: 'Нет Telegram? Восстановить кодом' }))
    fillCode({ login: ' Masha ' })
    fireEvent.click(screen.getByRole('button', { name: 'Сменить PIN и войти' }))
    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('ZZZZ-YYYY-XXXX-WWWW')
    expect(auth.resetPinByCode).toHaveBeenCalledWith('masha', 'abcd efgh jkmn pqrs', '4826')
    expect(onLogin).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранил, войти' }))
    expect(onLogin).toHaveBeenCalledWith(USER)
  })

  it('новый код не выпустился — вход все равно', async () => {
    vi.mocked(auth.resetPinByCode).mockResolvedValue(USER)
    vi.mocked(auth.createRecoveryCode).mockRejectedValue(new Error('limited'))
    const onLogin = vi.fn()
    render(<ForgotPin onBack={vi.fn()} onLogin={onLogin} />)
    fireEvent.click(screen.getByRole('button', { name: 'Нет Telegram? Восстановить кодом' }))
    fillCode()
    fireEvent.click(screen.getByRole('button', { name: 'Сменить PIN и войти' }))
    await vi.waitFor(() => expect(onLogin).toHaveBeenCalledWith(USER))
  })

  it('неверный код — понятный текст, форма остается', async () => {
    vi.mocked(auth.resetPinByCode).mockRejectedValue(new auth.LoginError('invalid', 'invalid'))
    render(<ForgotPin onBack={vi.fn()} onLogin={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Нет Telegram? Восстановить кодом' }))
    fillCode()
    fireEvent.click(screen.getByRole('button', { name: 'Сменить PIN и войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Логин или код не подходят')
    expect(screen.getByRole('button', { name: 'Сменить PIN и войти' })).toBeEnabled()
  })
})
