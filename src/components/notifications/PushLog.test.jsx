// @vitest-environment jsdom
import { it, vi, expect } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PushLog from './PushLog.jsx'
import { clearPushLog, diagnoseServiceWorkers, readPushLog } from '../../lib/pushIntent.js'
vi.mock('../../lib/pushIntent.js', () => ({
  readPushLog: vi.fn(async () => Array.from({ length: 120 }, (_, i) => ({ at: i, who: 'sw', ev: String(i) }))),
  clearPushLog: vi.fn(async () => {}), diagnoseServiceWorkers: vi.fn(async () => [{ scope: 'https://example.com/', ver: '9' }]),
}))
it('регистрации не создают вторую нумерацию, события идут одним списком от свежих', async () => {
  render(<PushLog />)
  const events = await screen.findByRole('list', { name: 'События пушей' })
  expect(events.tagName).toBe('OL')
  expect(within(events).getAllByRole('listitem')).toHaveLength(120)
  expect(within(events).getAllByRole('listitem')[0]).toHaveTextContent('119')
  await userEvent.click(screen.getByRole('button', { name: 'Проверить service worker' }))
  expect((await screen.findByRole('list', { name: 'Регистрации service worker' })).tagName).toBe('UL')
})

it('очистка перечитывает журнал, диагностика показывает пустой результат и сбой', async () => {
  vi.mocked(readPushLog).mockResolvedValue([])
  const check = Promise.withResolvers()
  vi.mocked(diagnoseServiceWorkers).mockReturnValueOnce(check.promise).mockRejectedValueOnce('Сбой проверки')
  render(<PushLog />)
  expect(await screen.findByText('Пусто.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
  expect(clearPushLog).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Проверить service worker' }))
  expect(screen.getByRole('button', { name: 'Проверяю…' })).toBeDisabled()
  await act(() => check.resolve([]))
  expect(screen.getByText('Регистраций нет')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Проверить service worker' }))
  expect(await screen.findByText(/Сбой проверки/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Проверить service worker' })).toBeEnabled()
})
