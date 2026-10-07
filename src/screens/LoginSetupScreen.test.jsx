// @vitest-environment jsdom
// «Придумай логин» (П4 «Мой круг», 07.10.2026): обязательный шаг для учеток без логина.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react'
import LoginSetupScreen from './LoginSetupScreen.jsx'
import { useLoginSetup } from '../hooks/useLoginSetup.js'
import { setMyLogin, getMyLogin, LoginError } from '../lib/auth.js'

vi.mock('../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  return { setMyLogin: vi.fn(), getMyLogin: vi.fn(), LoginError }
})

const SEGA = { id: 'u1', name: 'Сега', role: 'member' }

beforeEach(() => {
  vi.mocked(setMyLogin).mockReset()
  vi.mocked(getMyLogin).mockReset()
  vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: true })
})

describe('LoginSetupScreen', () => {
  it('поле пустое (из имени не подставляем); сохранение отдает логин наверх', async () => {
    vi.mocked(setMyLogin).mockResolvedValue('sega')
    const onDone = vi.fn()
    render(<LoginSetupScreen user={SEGA} onDone={onDone} onLogout={vi.fn()} />)
    expect(screen.getByText('Сега')).toBeInTheDocument() // имя для друзей не меняется
    const input = screen.getByLabelText('Логин (для входа)')
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: 'sega' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('sega'))
    expect(setMyLogin).toHaveBeenCalledWith('u1', 'sega')
  })

  it('занят — текст сервера, форма остается', async () => {
    vi.mocked(setMyLogin).mockRejectedValue(new LoginError('taken', 'Этот логин занят — придумай другой.'))
    render(<LoginSetupScreen user={SEGA} onDone={vi.fn()} onLogout={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Логин (для входа)'), { target: { value: 'masha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('занят')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  })

  it('кривой логин — отказ без сети', async () => {
    render(<LoginSetupScreen user={SEGA} onDone={vi.fn()} onLogout={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Логин (для входа)'), { target: { value: 'се' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('латиницей')
    expect(setMyLogin).not.toHaveBeenCalled()
  })

  it('«Это не я — выйти»', () => {
    const onLogout = vi.fn()
    render(<LoginSetupScreen user={SEGA} onDone={vi.fn()} onLogout={onLogout} />)
    fireEvent.click(screen.getByRole('button', { name: 'Это не я — выйти' }))
    expect(onLogout).toHaveBeenCalled()
  })
})

describe('useLoginSetup', () => {
  it('логина нет и сеть есть — шаг нужен; после done — нет', async () => {
    vi.mocked(getMyLogin).mockResolvedValue(null)
    const { result } = renderHook(() => useLoginSetup(SEGA))
    await waitFor(() => expect(result.current.needed).toBe(true))
    result.current.done()
    await waitFor(() => expect(result.current.needed).toBe(false))
  })

  it('логин есть — шаг не нужен', async () => {
    vi.mocked(getMyLogin).mockResolvedValue('sega')
    const { result } = renderHook(() => useLoginSetup(SEGA))
    await waitFor(() => expect(getMyLogin).toHaveBeenCalled())
    expect(result.current.needed).toBe(false)
  })

  it('офлайн — не спрашиваем сервер и пускаем; сбой проверки — тоже пускаем', async () => {
    vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: false })
    const off = renderHook(() => useLoginSetup(SEGA))
    expect(off.result.current.needed).toBe(false)
    expect(getMyLogin).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: true })
    vi.mocked(getMyLogin).mockRejectedValue(new LoginError('session', 'нет сессии'))
    const fail = renderHook(() => useLoginSetup(SEGA))
    await waitFor(() => expect(getMyLogin).toHaveBeenCalled())
    expect(fail.result.current.needed).toBe(false)
  })

  it('без пользователя — ничего', () => {
    const { result } = renderHook(() => useLoginSetup(null))
    expect(result.current.needed).toBe(false)
    expect(getMyLogin).not.toHaveBeenCalled()
  })
})
