// @vitest-environment jsdom
// Мой код в круг (покрытие тестами 20.10.2026: было 55 % строк): код крупно, срок и
// сколько вступили; «Скопировать» — текст с кодом и ссылкой; тап по коду — только код;
// «Поделиться», где есть; «Новый код» — с подтверждением; сбои — понятным текстом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CircleCode from './CircleCode.jsx'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const CIRCLE = { circle_id: 'c1', name: 'Зал' }
let api, writeText
beforeEach(() => {
  api = { myCode: vi.fn(async () => ({ code: '7F3Q9XWD', expires_at: '2026-10-25T12:00:00Z', uses: 3, max_uses: 10 })) }
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  delete navigator.share
})
afterEach(() => vi.clearAllMocks())

describe('CircleCode', () => {
  it('код крупно, срок и вступившие; «Скопировать» — текст с кругом, кодом и ссылкой', async () => {
    render(<CircleCode api={api} circle={CIRCLE} />)
    expect(await screen.findByTestId('fc-code')).toHaveTextContent('7F3Q-9XWD')
    expect(screen.getByText('до 25.10 · вступили 3 из 10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull() // нет Web Share
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0][0]
    expect(text).toMatch(/«Зал»/)
    expect(text).toMatch(/Код: 7F3Q-9XWD/)
    expect(text).toMatch(/#join=7F3Q9XWD$/)
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Скопировано' }))
  })

  it('тап по коду — копирует только код', async () => {
    render(<CircleCode api={api} circle={CIRCLE} />)
    fireEvent.click(await screen.findByTestId('fc-code'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('7F3Q-9XWD'))
    fireEvent.keyDown(screen.getByTestId('fc-code'), { key: 'Enter' })
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
  })

  it('буфер недоступен — подсказка переписать вручную', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<CircleCode api={api} circle={CIRCLE} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('перепиши код вручную')
  })

  it('есть Web Share — «Поделиться» отдает тот же текст; отмена не ломает', async () => {
    const share = vi.fn(async () => { throw new Error('AbortError') })
    navigator.share = share
    render(<CircleCode api={api} circle={CIRCLE} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/Код: 7F3Q-9XWD/) })))
  })

  it('«Новый код» — с подтверждением, старый сразу гаснет', async () => {
    render(<CircleCode api={api} circle={CIRCLE} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Новый код' }))
    expect(screen.getByText('Старый код сразу перестанет работать.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(api.myCode).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Новый код' }))
    api.myCode.mockResolvedValueOnce({ code: 'ABCD2345', uses: 0, max_uses: 10 })
    fireEvent.click(screen.getByRole('button', { name: 'Да, новый код' }))
    await waitFor(() => expect(screen.getByTestId('fc-code')).toHaveTextContent('ABCD-2345'))
    expect(api.myCode).toHaveBeenLastCalledWith('c1', true)
  })

  it('код не получили — текст ошибки вместо пустой карточки', async () => {
    api.myCode.mockRejectedValue(new Error('Нужен интернет.'))
    render(<CircleCode api={api} circle={CIRCLE} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Нужен интернет.')
    expect(screen.queryByTestId('fc-code')).toBeNull()
  })
})
