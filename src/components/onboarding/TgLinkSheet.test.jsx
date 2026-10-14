// @vitest-environment jsdom
// «Привяжи Telegram» при запуске (v7.5.0).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as auth from '../../lib/auth.js'
import TgLinkSheet from './TgLinkSheet.jsx'

vi.mock('../../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  return {
    getBotUsername: vi.fn(), createTgLinkToken: vi.fn(), getRecoveryStatus: vi.fn(), LoginError,
  }
})

const TOKEN = 'a'.repeat(43)
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(auth.getBotUsername).mockResolvedValue('kachalka_pin_bot')
  vi.mocked(auth.createTgLinkToken).mockResolvedValue(TOKEN)
})
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('TgLinkSheet', () => {
  it('перепривязка: ссылка на нового бота готова сразу, «Позже» — только через 3 с', async () => {
    const onClose = vi.fn()
    render(<TgLinkSheet kind="relink" userId="u1" onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Перепривяжи Telegram' })).toBeInTheDocument()
    await flush()
    expect(screen.getByRole('link', { name: 'Привязать Telegram' }))
      .toHaveAttribute('href', `https://t.me/kachalka_pin_bot?start=${TOKEN}`)
    const later = screen.getByRole('button', { name: /Позже, через 3 с/ })
    expect(later).toBeDisabled()
    fireEvent.click(later)
    expect(onClose).not.toHaveBeenCalled()
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
    expect(onClose).toHaveBeenCalledWith('later')
  })

  it('мимо листа не закрыть: ни Escape, ни кнопки в шапке', async () => {
    const onClose = vi.fn()
    render(<TgLinkSheet kind="link" userId="u1" onClose={onClose} />)
    await flush()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('.overlay'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'закрыть' })).toBeNull()
    expect(screen.getByText(/Напомню через 3 дня/)).toBeInTheDocument()
  })

  it('вернулся из Telegram с привязкой в новом боте — лист закрывается сам', async () => {
    const onClose = vi.fn()
    vi.mocked(auth.getRecoveryStatus)
      .mockResolvedValueOnce({ tgLinked: true, tgBot: 'notifier' })
      .mockResolvedValueOnce({ tgLinked: true, tgBot: 'pin' })
    render(<TgLinkSheet kind="relink" userId="u1" onClose={onClose} />)
    await flush()
    fireEvent.click(screen.getByRole('link', { name: 'Привязать Telegram' }))
    expect(screen.getByRole('status')).toHaveTextContent('нажми «Старт»')
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve() })
    await flush()
    expect(onClose).not.toHaveBeenCalled() // еще старый бот
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve() })
    await flush()
    expect(onClose).toHaveBeenCalledWith('linked')
  })

  it('ссылка не готовится — ошибка и «Попробовать снова»', async () => {
    vi.mocked(auth.createTgLinkToken).mockRejectedValueOnce(new auth.LoginError('limited', 'Слишком часто — попробуй завтра.'))
    render(<TgLinkSheet kind="link" userId="u1" onClose={vi.fn()} />)
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком часто')
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    await flush()
    expect(screen.getByRole('link', { name: 'Привязать Telegram' })).toBeInTheDocument()
  })
})
