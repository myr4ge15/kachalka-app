// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import FriendByCode from './FriendByCode.jsx'

it('короткий код остается локальной ошибкой, сетевой сбой разрешает повтор', async () => {
  const preview = vi.fn().mockRejectedValueOnce(new Error('Сбой проверки'))
  render(<FriendByCode api={{ preview }} />)
  const field = screen.getByLabelText('Код друга')
  fireEvent.change(field, { target: { value: 'ABC' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(screen.getByRole('status')).toHaveTextContent('Код не подходит')
  expect(preview).not.toHaveBeenCalled()
  fireEvent.change(field, { target: { value: 'ABCDEFGH' } })
  fireEvent.keyDown(field, { key: 'Tab' })
  expect(preview).not.toHaveBeenCalled()
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(await screen.findByText('Сбой проверки')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled()
})

it.each(['already', 'invalid'])('ответ %s определяет, завершено ли добавление', async (status) => {
  const request = Promise.withResolvers()
  const onAdded = vi.fn()
  const api = { preview: vi.fn(async () => ({ status: 'ok', inviter_name: 'Маша' })), acceptCode: vi.fn(() => request.promise) }
  render(<FriendByCode api={api} initialCode="ABCDEFGH" onAdded={onAdded} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Принять' }))
  expect(screen.getByRole('button', { name: 'Добавляю…' })).toBeDisabled()
  await act(() => request.resolve({ status }))
  if (status === 'already') expect(onAdded).toHaveBeenCalledExactlyOnceWith({ status })
  else expect(onAdded).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Код друга')).toHaveValue(status === 'already' ? '' : 'ABCD-EFGH')
})
