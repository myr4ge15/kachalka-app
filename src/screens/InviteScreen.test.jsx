// @vitest-environment jsdom
// Экран регистрации по ссылке-приглашению (v6.8.0).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import InviteScreen from './InviteScreen.jsx'
import { checkInvite, registerByInvite, LoginError } from '../lib/auth.js'

vi.mock('../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  return { checkInvite: vi.fn(), registerByInvite: vi.fn(), LoginError }
})

const TOKEN = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'

function fill({ name = 'Маша', pin = '4826', pin2 = '4826' } = {}) {
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('PIN — 4 цифры'), { target: { value: pin } })
  fireEvent.change(screen.getByLabelText('PIN еще раз'), { target: { value: pin2 } })
}

beforeEach(() => {
  vi.mocked(checkInvite).mockReset()
  vi.mocked(registerByInvite).mockReset()
})

describe('InviteScreen', () => {
  it('живая ссылка → форма; регистрация отдает пользователя наверх', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    const user = { id: 'u9', name: 'Маша', role: 'member' }
    vi.mocked(registerByInvite).mockResolvedValue(user)
    const onRegistered = vi.fn()
    render(<InviteScreen token={TOKEN} onRegistered={onRegistered} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя')
    fill({ name: '  Маша ' })
    fireEvent.click(screen.getByRole('radio', { name: 'Женский' }))
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(user))
    expect(registerByInvite).toHaveBeenCalledWith(TOKEN, { name: 'Маша', pin: '4826', sex: 'f' })
  })

  it('PIN-коды не совпали — на сервер не идем', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя')
    fill({ pin2: '4321' })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('не совпадают')
    expect(registerByInvite).not.toHaveBeenCalled()
  })

  it('PIN принимает только цифры', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    const pin = await screen.findByLabelText('PIN — 4 цифры')
    fireEvent.change(pin, { target: { value: '1a2b345' } })
    expect(pin.value).toBe('1234')
  })

  it('имя занято — понятная ошибка, форма остается', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    vi.mocked(registerByInvite).mockRejectedValue(new LoginError('name_taken', 'name_taken'))
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('занято')
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
  })

  it('использованная ссылка — объяснение и выход к входу', async () => {
    vi.mocked(checkInvite).mockResolvedValue('used')
    const onCancel = vi.fn()
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={onCancel} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('уже зарегистрировались')
    expect(screen.queryByLabelText('Имя')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'К входу' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('ссылку успели использовать, пока заполняли форму', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    vi.mocked(registerByInvite).mockRejectedValue(new LoginError('used', 'used'))
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('одноразовая')
  })

  it('на устройстве уже вошли — сначала предлагаем выйти, ссылку не проверяем', async () => {
    const onSignOut = vi.fn(async () => {})
    render(<InviteScreen token={TOKEN} signedInAs="Дима" onRegistered={vi.fn()} onCancel={vi.fn()} onSignOut={onSignOut} />)
    expect(screen.getByText('Дима')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Выйти и продолжить' }))
    await waitFor(() => expect(onSignOut).toHaveBeenCalled())
    expect(checkInvite).not.toHaveBeenCalled()
  })

  it('нет связи при проверке — можно повторить', async () => {
    vi.mocked(checkInvite).mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce('ok')
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Еще раз' }))
    expect(await screen.findByLabelText('Имя')).toBeInTheDocument()
  })
})
