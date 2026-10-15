// @vitest-environment jsdom
import { it, vi, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PushLog from './PushLog.jsx'
vi.mock('../../lib/pushIntent.js', () => ({
  readPushLog: async () => Array.from({ length: 120 }, (_, i) => ({ at: i, who: 'sw', ev: String(i) })),
  clearPushLog: vi.fn(), diagnoseServiceWorkers: async () => [{ scope: 'https://example.com/', ver: '9' }],
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
