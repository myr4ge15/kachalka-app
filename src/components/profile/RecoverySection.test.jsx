// @vitest-environment jsdom
// «🔐 Восстановление доступа» в Настройках (П1, v6.18.0).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import RecoverySection from './RecoverySection.jsx'
import * as auth from '../../lib/auth.js'

vi.mock('../../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  return {
    getRecoveryStatus: vi.fn(), createRecoveryCode: vi.fn(), createTgLinkToken: vi.fn(),
    unlinkTg: vi.fn(async () => null), getBotUsername: vi.fn(), LoginError,
  }
})
vi.mock('../Toast.jsx', () => ({ showToast: vi.fn() }))

const T = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'
const NONE = { hasCode: false, codeCreatedAt: null, tgLinked: false, tgLinkedAt: null }
beforeEach(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }))
afterEach(() => vi.clearAllMocks())

const openIt = () => fireEvent.click(screen.getByRole('button', { name: /Восстановление доступа/ }))

describe('RecoverySection', () => {
  it('свернуто — без запросов; раскрыто — статус', async () => {
    vi.mocked(auth.getRecoveryStatus).mockResolvedValue(NONE)
    render(<RecoverySection userId="u1" />)
    expect(auth.getRecoveryStatus).not.toHaveBeenCalled()
    openIt()
    expect(await screen.findByTestId('tg-state')).toHaveTextContent('Не привязан')
    expect(screen.getByTestId('code-state')).toHaveTextContent('Нет кода')
  })

  it('привязка Telegram — ссылка t.me с токеном', async () => {
    vi.mocked(auth.getRecoveryStatus).mockResolvedValue(NONE)
    vi.mocked(auth.getBotUsername).mockResolvedValue('kachalka_bot')
    vi.mocked(auth.createTgLinkToken).mockResolvedValue(T)
    render(<RecoverySection userId="u1" />)
    openIt()
    fireEvent.click(await screen.findByRole('button', { name: 'Привязать Telegram' }))
    const a = await screen.findByRole('link', { name: 'Открыть бота в Telegram' })
    expect(a).toHaveAttribute('href', `https://t.me/kachalka_bot?start=${T}`)
  })

  it('отвязка — с подтверждением', async () => {
    vi.mocked(auth.getRecoveryStatus).mockResolvedValue({ ...NONE, tgLinked: true, tgLinkedAt: '2026-10-07T10:00:00Z' })
    render(<RecoverySection userId="u1" />)
    openIt()
    expect(await screen.findByTestId('tg-state')).toHaveTextContent('Привязан')
    fireEvent.click(screen.getByRole('button', { name: 'Отвязать' }))
    expect(auth.unlinkTg).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Точно отвязать?' }))
    await vi.waitFor(() => expect(auth.unlinkTg).toHaveBeenCalledWith('u1'))
  })

  it('код есть → «Новый код» спрашивает, потом показывает один раз', async () => {
    vi.mocked(auth.getRecoveryStatus).mockResolvedValue({ ...NONE, hasCode: true, codeCreatedAt: '2026-10-07T10:00:00Z' })
    vi.mocked(auth.createRecoveryCode).mockResolvedValue('ABCD-EFGH-JKMN-PQRS')
    render(<RecoverySection userId="u1" />)
    openIt()
    fireEvent.click(await screen.findByRole('button', { name: 'Новый код' }))
    expect(screen.getByText(/Прежний код перестанет действовать/)).toBeInTheDocument()
    expect(auth.createRecoveryCode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Да, выпустить новый' }))
    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('ABCD-EFGH-JKMN-PQRS')
    fireEvent.click(screen.getByRole('button', { name: 'Я сохранил код' }))
    expect(screen.queryByTestId('recovery-code')).toBeNull()
  })

  it('офлайн — «виден онлайн», без запроса', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    render(<RecoverySection userId="u1" />)
    openIt()
    expect(await screen.findByRole('alert')).toHaveTextContent('онлайн')
    expect(auth.getRecoveryStatus).not.toHaveBeenCalled()
  })
})
