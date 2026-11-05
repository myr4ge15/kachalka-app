// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DomainMigration from './DomainMigration.jsx'
import { checkDomainMigration } from '../../db/domainMigration.js'

vi.mock('../../db/domainMigration.js', () => ({ checkDomainMigration: vi.fn() }))
vi.mock('../../db/domainMigrationStatus.js', () => ({ reportMigrationCheck: vi.fn() }))
vi.mock('../ui/SheetDialog.jsx', () => ({ default: ({ title, children }) => <section role="dialog" aria-label={title}>{children}</section> }))
const assign = vi.fn()
beforeEach(() => {
  assign.mockReset()
  vi.mocked(checkDomainMigration).mockReset()
  vi.stubGlobal('window', { document, location: { hostname: 'myr4ge15.github.io', pathname: '/kachalka-app/', assign } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('на этапе подготовки баннера нет', () => {
  render(<DomainMigration userId="u1" phase="" />)
  expect(screen.queryByRole('complementary')).toBeNull()
})
it('новый домен и бета не показывают приглашение к переезду', () => {
  window.location.hostname = 'kachalka-app.ru'
  render(<DomainMigration userId="u1" phase="announce" />)
  expect(screen.queryByRole('complementary')).toBeNull()
})
it('открывает инструкцию; Позже не меняет адрес', () => {
  render(<DomainMigration userId="u1" phase="announce" />)
  fireEvent.click(screen.getByRole('button', { name: 'Как перейти' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('прежними логином и PIN')
  expect(screen.getByRole('dialog')).toHaveTextContent('другие учетки')
  fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(assign).not.toHaveBeenCalled()
})
it.each(['offline', 'draft', 'sync', 'account', 'pending'])('блокирует переход при %s', async (reason) => {
  vi.mocked(checkDomainMigration).mockResolvedValue(reason)
  render(<DomainMigration userId="u1" phase="retire" />)
  fireEvent.click(screen.getByRole('button', { name: 'Проверить данные и перейти' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(assign).not.toHaveBeenCalled()
})
it('ошибка чтения базы не дает ложного разрешения', async () => {
  vi.mocked(checkDomainMigration).mockRejectedValue(new Error('IDB unavailable'))
  render(<DomainMigration userId="u1" phase="retire" />)
  fireEvent.click(screen.getByRole('button', { name: 'Проверить данные и перейти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить')
  expect(assign).not.toHaveBeenCalled()
})
it('блокирует повторный тап на время проверки; переходит только после ready', async () => {
  let resolve
  vi.mocked(checkDomainMigration).mockReturnValue(new Promise((r) => { resolve = r }))
  render(<DomainMigration userId="u1" phase="retire" />)
  const button = screen.getByRole('button', { name: 'Проверить данные и перейти' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(button).toBeDisabled()
  expect(checkDomainMigration).toHaveBeenCalledTimes(1)
  expect(assign).not.toHaveBeenCalled()
  resolve('ready')
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://kachalka-app.ru/app/'))
})
