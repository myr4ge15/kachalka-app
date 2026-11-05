// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DomainMigrationSection from './DomainMigrationSection.jsx'
import { fetchDomainMigrationStatus } from '../../db/domainMigrationStatus.js'
vi.mock('../../db/domainMigrationStatus.js', () => ({ fetchDomainMigrationStatus: vi.fn() }))
beforeEach(() => { vi.resetAllMocks() })
afterEach(cleanup)
const props = { userId: 'admin', online: true }

it('показывает и неизвестных участников, и все старые устройства без ложного подтверждения', async () => {
  fetchDomainMigrationStatus.mockResolvedValue([
    { user_id: 'u', name: 'Саня', devices: [
      { domain: 'new', device_id: 'n', last_seen_at: new Date().toISOString() },
      { domain: 'old', device_id: 'o1', device_label: 'iPhone', last_seen_at: new Date().toISOString(), save_state: 'ready', checked_at: new Date().toISOString(), version: '1.10.0' },
      { domain: 'old', device_id: 'o2', device_label: 'Браузер', last_seen_at: new Date().toISOString(), save_state: 'draft', checked_at: new Date().toISOString(), version: '1.10.0' },
    ] },
    { user_id: 'x', name: 'Маша', devices: [] },
  ])
  render(<DomainMigrationSection {...props} />)
  expect(await screen.findByRole('article', { name: 'Саня' })).toHaveTextContent('Не на всех известных устройствах подтверждено')
  expect(screen.getByRole('article', { name: 'Маша' })).toHaveTextContent('Пока нет данных')
  expect(screen.getByText(/Заходили на новый: 1 из 2/)).toBeInTheDocument()
  expect(screen.getByText(/iPhone · устройство 1/)).toHaveTextContent('Все сохранено на последней проверке')
  expect(screen.getByText(/Браузер · устройство 2/)).toHaveTextContent('Есть незавершенная')
})
it('ошибка не превращается в пустой успешный список; можно обновить', async () => {
  fetchDomainMigrationStatus.mockRejectedValueOnce(new Error('Нужен SQL')).mockResolvedValueOnce([])
  render(<DomainMigrationSection {...props} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Нужен SQL')
  fireEvent.click(screen.getByRole('button', { name: 'Обновить статусы' }))
  expect(await screen.findByText('Участников пока нет.')).toBeInTheDocument()
})
it('офлайн не читает сеть и не показывает прежние статусы как текущие', async () => {
  fetchDomainMigrationStatus.mockResolvedValue([{ user_id: 'u', name: 'Саня', devices: [] }])
  const view = render(<DomainMigrationSection {...props} />)
  await screen.findByRole('article')
  view.rerender(<DomainMigrationSection {...props} online={false} />)
  expect(screen.queryByRole('article')).toBeNull()
  expect(screen.getByRole('button')).toBeDisabled()
  expect(fetchDomainMigrationStatus).toHaveBeenCalledTimes(1)
})
it('ответ после ухода из раздела игнорируется', async () => {
  let finish
  fetchDomainMigrationStatus.mockReturnValue(new Promise((r) => { finish = r }))
  const view = render(<DomainMigrationSection {...props} />)
  view.unmount()
  finish([])
  await waitFor(() => expect(screen.queryByText('Участников пока нет.')).toBeNull())
})
it('все известные старые устройства проверены', async () => {
  fetchDomainMigrationStatus.mockResolvedValue([{ user_id: 'u', name: 'Саня', devices: [
    { domain: 'old', device_id: 'o', device_label: 'iPad', last_seen_at: '2026-01-01', save_state: 'ready', checked_at: '2026-01-01', version: '1.10.0' },
  ] }])
  render(<DomainMigrationSection {...props} />)
  expect(await screen.findByRole('article')).toHaveTextContent('Все сохранено на последних проверках известных устройств')
  expect(screen.getByRole('article')).toHaveTextContent('Давняя активность')
})
