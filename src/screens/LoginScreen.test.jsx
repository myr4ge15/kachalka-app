// @vitest-environment jsdom
// Экран входа (v6.12.0): пикер — только учетки устройства, вход по имени,
// «Забыть на этом устройстве», статус заявки «Попросить приглашение». Список участников
// экран больше не запрашивает (кто случайно открыл ссылку, круг не видит).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoginScreen from './LoginScreen.jsx'
import * as auth from '../lib/auth.js'
import * as join from '../lib/joinRequest.js'

vi.mock('../db/repo.js', () => ({ getUsers: vi.fn(async () => [{ id: 'u1', name: 'Дима' }, { id: 'u9', name: 'Чужой' }]) }))
vi.mock('../db/local.js', () => ({ migrateLoginZone: vi.fn(async () => {}) }))
vi.mock('../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message, retryAfter = null) { super(message); this.code = code; this.retryAfter = retryAfter }
  }
  return {
    login: vi.fn(),
    loginByName: vi.fn(),
    verifyPinOffline: vi.fn(),
    dropForeignSession: vi.fn(async () => {}),
    noteLoginFailure: vi.fn(),
    knownAccounts: vi.fn(),
    forgetAccount: vi.fn(async () => {}),
    LoginError,
  }
})
vi.mock('../lib/joinRequest.js', async (orig) => {
  const real = await orig()
  return { ...real, loadPending: vi.fn(() => null), savePending: vi.fn(), clearPending: vi.fn(), pollJoin: vi.fn(), submitJoin: vi.fn() }
})

const DIMA = { id: 'u1', name: 'Дима', role: 'member' }

beforeEach(() => {
  vi.mocked(auth.knownAccounts).mockResolvedValue([DIMA])
  vi.mocked(join.loadPending).mockReturnValue(null)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(() => vi.clearAllMocks())

const typePin = (digits) => { for (const d of digits) fireEvent.click(screen.getByRole('button', { name: d })) }

describe('LoginScreen', () => {
  it('пикер показывает только учетки устройства', async () => {
    render(<LoginScreen onLogin={() => {}} />)
    expect(await screen.findByText('Дима')).toBeInTheDocument()
    expect(screen.queryByText('Чужой')).not.toBeInTheDocument()
    expect(auth.knownAccounts).toHaveBeenCalledWith([{ id: 'u1', name: 'Дима' }, { id: 'u9', name: 'Чужой' }])
  })

  it('учетка устройства онлайн: PIN проверяет сервер, кэш не нужен', async () => {
    vi.mocked(auth.login).mockResolvedValue(DIMA)
    const onLogin = vi.fn()
    render(<LoginScreen onLogin={onLogin} />)
    fireEvent.click(await screen.findByText('Дима'))
    typePin('1234')
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(DIMA))
    expect(auth.login).toHaveBeenCalledWith('u1', '1234', { timeoutMs: 8000 })
    expect(auth.verifyPinOffline).not.toHaveBeenCalled()
  })

  it('онлайн, старый PIN из кэша: сервер отказал — приложение НЕ открывается', async () => {
    // ревью 06.10.2026, п. 6: раньше кэш пускал до ответа сервера
    vi.mocked(auth.verifyPinOffline).mockResolvedValue(DIMA)
    const err = new auth.LoginError('invalid', 'Неверный PIN')
    vi.mocked(auth.login).mockRejectedValue(err)
    const onLogin = vi.fn()
    render(<LoginScreen onLogin={onLogin} />)
    fireEvent.click(await screen.findByText('Дима'))
    typePin('1234')
    expect(await screen.findByText('Неверный PIN')).toBeInTheDocument()
    expect(onLogin).not.toHaveBeenCalled()
    expect(auth.verifyPinOffline).not.toHaveBeenCalled()
    expect(auth.noteLoginFailure).toHaveBeenCalledWith(err)
  })

  it('онлайн, сервер запер попытки — кэш блокировку не обходит', async () => {
    vi.mocked(auth.verifyPinOffline).mockResolvedValue(DIMA)
    vi.mocked(auth.login).mockRejectedValue(new auth.LoginError('locked', 'x', 900))
    const onLogin = vi.fn()
    render(<LoginScreen onLogin={onLogin} />)
    fireEvent.click(await screen.findByText('Дима'))
    typePin('1234')
    expect(await screen.findByText(/через 15 мин/)).toBeInTheDocument()
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('сервер не ответил (сеть/таймаут) — вход по кэшу, как офлайн', async () => {
    vi.mocked(auth.login).mockRejectedValue(new auth.LoginError('network', 'Нет сети'))
    vi.mocked(auth.verifyPinOffline).mockResolvedValue(DIMA)
    const onLogin = vi.fn()
    render(<LoginScreen onLogin={onLogin} />)
    fireEvent.click(await screen.findByText('Дима'))
    typePin('1234')
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(DIMA))
    expect(auth.verifyPinOffline).toHaveBeenCalledWith('u1', '1234')
    expect(auth.dropForeignSession).toHaveBeenCalledWith('u1')
  })

  it('офлайн — сразу по кэшу, без запроса', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(auth.verifyPinOffline).mockResolvedValue(false)
    render(<LoginScreen onLogin={() => {}} />)
    fireEvent.click(await screen.findByText('Дима'))
    typePin('1234')
    expect(await screen.findByText('Неверный PIN')).toBeInTheDocument()
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('новое устройство (никто не входил) — сразу форма имени, вход по имени', async () => {
    vi.mocked(auth.knownAccounts).mockResolvedValue([])
    vi.mocked(auth.loginByName).mockResolvedValue({ id: 'u2', name: 'Анечка (ничего не делала)', role: 'member' })
    const onLogin = vi.fn()
    render(<LoginScreen onLogin={onLogin} />)
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'анечка' } })
    fireEvent.change(screen.getByLabelText('PIN — 4 цифры'), { target: { value: '12a34' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalled())
    expect(auth.loginByName).toHaveBeenCalledWith('анечка', '1234')
    expect(screen.queryByRole('button', { name: /К списку/ })).not.toBeInTheDocument()
  })

  it('вход по имени: неверно — одна и та же ошибка, PIN очищается', async () => {
    vi.mocked(auth.loginByName).mockRejectedValue(new auth.LoginError('invalid', 'Имя или PIN не подходят'))
    render(<LoginScreen onLogin={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Войти под другим именем' }))
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Кто-то' } })
    fireEvent.change(screen.getByLabelText('PIN — 4 цифры'), { target: { value: '0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Имя или PIN не подходят')
    expect(screen.getByLabelText('PIN — 4 цифры')).toHaveValue('')
  })

  it('вход по имени офлайн — сразу понятный отказ, без запроса', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(auth.knownAccounts).mockResolvedValue([])
    render(<LoginScreen onLogin={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Имя'), { target: { value: 'Дима' } })
    fireEvent.change(screen.getByLabelText('PIN — 4 цифры'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/только онлайн/)
    expect(auth.loginByName).not.toHaveBeenCalled()
  })

  it('«Забыть на этом устройстве» — с подтверждением, потом список без учетки', async () => {
    render(<LoginScreen onLogin={() => {}} />)
    fireEvent.click(await screen.findByText('Дима'))
    fireEvent.click(screen.getByRole('button', { name: 'Забыть на этом устройстве' }))
    expect(auth.forgetAccount).not.toHaveBeenCalled()
    vi.mocked(auth.knownAccounts).mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Точно убрать из списка?' }))
    await waitFor(() => expect(auth.forgetAccount).toHaveBeenCalledWith('u1'))
    expect(await screen.findByLabelText('Имя')).toBeInTheDocument()
  })

  it('«Попросить приглашение»: форма → заявка отправлена, кнопка исчезает', async () => {
    vi.mocked(join.submitJoin).mockResolvedValue({ id: 'r1', secret: 's', name: 'Вася', at: 1 })
    render(<LoginScreen onLogin={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Попросить приглашение' }))
    fireEvent.change(screen.getByLabelText('Как тебя зовут'), { target: { value: 'Вася' } })
    fireEvent.change(screen.getByLabelText('Пара слов о себе'), { target: { value: 'друг Димы' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }))
    expect(await screen.findByText('Заявка отправлена')).toBeInTheDocument()
    expect(join.submitJoin).toHaveBeenCalledWith({ name: 'Вася', about: 'друг Димы', website: '' })
    expect(screen.queryByRole('button', { name: 'Попросить приглашение' })).not.toBeInTheDocument()
  })

  it('заявку одобрили — экран отдает токен приглашения и запоминает его', async () => {
    vi.mocked(join.loadPending).mockReturnValue({ id: 'r1', secret: 's', name: 'Вася' })
    vi.mocked(join.pollJoin).mockResolvedValue({ status: 'approved', token: 'TOKEN' })
    const onInvite = vi.fn()
    render(<LoginScreen onLogin={() => {}} onInvite={onInvite} />)
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith('TOKEN'))
    expect(join.savePending).toHaveBeenCalledWith({ id: 'r1', secret: 's', name: 'Вася', token: 'TOKEN' })
    expect(await screen.findByRole('button', { name: 'Зарегистрироваться' })).toBeInTheDocument()
  })

  it('заявку отклонили — сообщение, локальная заявка стерта', async () => {
    vi.mocked(join.loadPending).mockReturnValue({ id: 'r1', secret: 's', name: 'Вася' })
    vi.mocked(join.pollJoin).mockResolvedValue({ status: 'declined' })
    render(<LoginScreen onLogin={() => {}} />)
    expect(await screen.findByText(/не принял заявку/)).toBeInTheDocument()
    expect(join.clearPending).toHaveBeenCalled()
  })
})
