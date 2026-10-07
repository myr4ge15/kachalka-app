// @vitest-environment jsdom
// Экран регистрации по ссылке-приглашению (v6.8.0).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import InviteScreen from './InviteScreen.jsx'
import { checkInvite, checkLoginForInvite, registerByInvite, createRecoveryCode, LoginError } from '../lib/auth.js'

vi.mock('../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  return { checkInvite: vi.fn(), checkLoginForInvite: vi.fn(async () => 'ok'), registerByInvite: vi.fn(), createRecoveryCode: vi.fn(), LoginError }
})

const TOKEN = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'

function fill({ login = 'masha', name = 'Маша', pin = '4826', pin2 = '4826' } = {}) {
  fireEvent.change(screen.getByLabelText('Логин (для входа)'), { target: { value: login } })
  fireEvent.change(screen.getByLabelText('Имя (как тебя увидят)'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('PIN — 4 цифры'), { target: { value: pin } })
  fireEvent.change(screen.getByLabelText('PIN еще раз'), { target: { value: pin2 } })
}

beforeEach(() => {
  vi.mocked(checkInvite).mockReset()
  vi.mocked(registerByInvite).mockReset()
  vi.mocked(createRecoveryCode).mockReset().mockRejectedValue(new Error('нет'))
})

describe('InviteScreen', () => {
  it('живая ссылка → форма; регистрация отдает пользователя наверх', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    const user = { id: 'u9', name: 'Маша', role: 'member' }
    vi.mocked(registerByInvite).mockResolvedValue(user)
    const onRegistered = vi.fn()
    render(<InviteScreen token={TOKEN} onRegistered={onRegistered} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя (как тебя увидят)')
    fill({ name: '  Маша ' })
    fireEvent.click(screen.getByRole('radio', { name: 'Женский' }))
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(user))
    expect(registerByInvite).toHaveBeenCalledWith(TOKEN, { name: 'Маша', pin: '4826', sex: 'f', login: 'masha' })
  })

  it('PIN-коды не совпали — на сервер не идем', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя (как тебя увидят)')
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

  it('логин заняли — понятная ошибка, форма остается', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    vi.mocked(registerByInvite).mockRejectedValue(new LoginError('login_taken', 'login_taken'))
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя (как тебя увидят)')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('логин занят')
    expect(screen.getByLabelText('Имя (как тебя увидят)')).toBeInTheDocument()
  })

  // П4 (07.10.2026, решение владельца): логин — первым полем, из имени НЕ подставляется.
  it('логин: первым полем, сам не подставляется, занятость — сразу', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    vi.mocked(checkLoginForInvite).mockImplementation(async (t, v) => (v === 'sega' ? 'taken' : 'ok'))
    const { container } = render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Логин (для входа)')
    const inputs = [...container.querySelectorAll('input')]
    expect(inputs[0]).toBe(screen.getByLabelText('Логин (для входа)'))
    expect(inputs[1]).toBe(screen.getByLabelText('Имя (как тебя увидят)'))
    fireEvent.change(screen.getByLabelText('Имя (как тебя увидят)'), { target: { value: 'Сега' } })
    const login = screen.getByLabelText('Логин (для входа)')
    expect(login.value).toBe('')
    fireEvent.change(login, { target: { value: 'sega' } })
    expect(await screen.findByText('Этот логин занят — придумай другой.', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(checkLoginForInvite).toHaveBeenCalledWith(TOKEN, 'sega')
    fireEvent.change(login, { target: { value: 'sega77' } })
    expect(await screen.findByText('Свободен ✓', {}, { timeout: 2000 })).toBeInTheDocument()
  })

  it('без логина — на сервер не идем', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Логин (для входа)')
    fill({ login: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Придумай логин')
    expect(registerByInvite).not.toHaveBeenCalled()
  })

  it('кириллица в логине — подсказка сразу, на сервер не идем', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    vi.mocked(checkLoginForInvite).mockClear()
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Логин (для входа)'), { target: { value: 'сега' } })
    expect(screen.getByText(/латиницей/)).toBeInTheDocument()
    expect(checkLoginForInvite).not.toHaveBeenCalled()
  })

  it('использованная ссылка — объяснение и выход к входу', async () => {
    vi.mocked(checkInvite).mockResolvedValue('used')
    const onCancel = vi.fn()
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={onCancel} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('уже зарегистрировались')
    expect(screen.queryByLabelText('Имя (как тебя увидят)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'К входу' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('ссылку успели использовать, пока заполняли форму', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    vi.mocked(registerByInvite).mockRejectedValue(new LoginError('used', 'used'))
    render(<InviteScreen token={TOKEN} onRegistered={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя (как тебя увидят)')
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
    expect(await screen.findByLabelText('Имя (как тебя увидят)')).toBeInTheDocument()
  })

  it('после регистрации — код восстановления один раз, потом наверх (П1)', async () => {
    vi.mocked(checkInvite).mockResolvedValue('ok')
    const user = { id: 'u9', name: 'Маша', role: 'member' }
    vi.mocked(registerByInvite).mockResolvedValue(user)
    vi.mocked(createRecoveryCode).mockResolvedValue('ABCD-EFGH-JKMN-PQRS')
    const onRegistered = vi.fn()
    render(<InviteScreen token={TOKEN} onRegistered={onRegistered} onCancel={vi.fn()} />)
    await screen.findByLabelText('Имя (как тебя увидят)')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('ABCD-EFGH-JKMN-PQRS')
    expect(createRecoveryCode).toHaveBeenCalledWith('u9')
    expect(onRegistered).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранил, дальше' }))
    expect(onRegistered).toHaveBeenCalledWith(user)
  })
})
