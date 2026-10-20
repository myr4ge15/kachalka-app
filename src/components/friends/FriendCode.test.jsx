// @vitest-environment jsdom
// Мой код дружбы (покрытие тестами 20.10.2026: было 62 % строк): «Скопировать» — текст с
// кодом и ссылкой #friend=; тап по коду — только код; «Поделиться», где есть; «Новый код» —
// с подтверждением и отменой; сбои — понятным текстом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FriendCode from './FriendCode.jsx'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

let api, writeText
beforeEach(() => {
  api = { myCode: vi.fn(async () => ({ code: '7F3Q9XWD' })) }
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  delete navigator.share
})
afterEach(() => vi.clearAllMocks())

describe('FriendCode', () => {
  it('«Скопировать» — имя, код и ссылка #friend=', async () => {
    render(<FriendCode api={api} myName="Сега" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0][0]
    expect(text).toMatch(/7F3Q-9XWD/)
    expect(text).toMatch(/#friend=7F3Q9XWD/)
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Скопировано' }))
  })

  it('тап и Enter по коду — копирует только код; без буфера — тихо', async () => {
    render(<FriendCode api={api} myName="Сега" />)
    const code = await screen.findByTestId('fr-code')
    fireEvent.click(code)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('7F3Q-9XWD'))
    fireEvent.keyDown(code, { key: 'Enter' })
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    writeText.mockRejectedValue(new Error('denied'))
    fireEvent.click(code)
    await Promise.resolve()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('буфер недоступен у «Скопировать» — подсказка переписать вручную', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<FriendCode api={api} myName="Сега" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('перепиши код вручную')
  })

  it('Web Share есть — «Поделиться» главная, отмена не ломает', async () => {
    navigator.share = vi.fn(async () => { throw new Error('AbortError') })
    render(<FriendCode api={api} myName="Сега" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }))
    await waitFor(() => expect(navigator.share).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Скопировать' })).toHaveClass('ghost')
  })

  it('«Новый код» → «Отмена» ничего не меняет', async () => {
    render(<FriendCode api={api} myName="Сега" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Новый код' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByRole('button', { name: 'Новый код' })).toBeInTheDocument()
    expect(api.myCode).toHaveBeenCalledTimes(1)
  })

  it('код не получили — текст ошибки', async () => {
    api.myCode.mockRejectedValue(new Error('Нужен интернет.'))
    render(<FriendCode api={api} myName="Сега" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Нужен интернет.')
  })
})
