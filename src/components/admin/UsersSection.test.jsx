// @vitest-environment jsdom
// Админка → «Пользователи»: добавление участника и сброс PIN (покрытие тестами 19.10.2026).
// Правка участника и инцидент «у всех слетел пол» — в screens/AdminScreen.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import UsersSection from './UsersSection.jsx'
import { adminCreateUser, adminListUsers, adminResetPin, adminSetSex } from '../../lib/admin.js'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../../lib/admin.js', () => ({
  adminListUsers: vi.fn(), adminSetUser: vi.fn(), adminSetSex: vi.fn(async () => {}),
  adminResetPin: vi.fn(), adminCreateUser: vi.fn(), adminDeleteUser: vi.fn(),
}))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const DIMA = { id: 'u2', name: 'Дима', role: 'member', sex: 'm' }
const errMsg = (e) => e.message

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(adminListUsers).mockResolvedValue([DIMA])
})
afterEach(() => vi.clearAllMocks())

async function openAdd() {
  render(<UsersSection meId="me" online errMsg={errMsg} />)
  await screen.findByText('Дима')
  fireEvent.click(screen.getByRole('button', { name: '+ Добавить участника' }))
}
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('UsersSection — новый участник', () => {
  it('«Добавить» неактивна, пока нет логина, имени и PIN из 4 цифр', async () => {
    await openAdd()
    const add = screen.getByRole('button', { name: 'Добавить' })
    expect(add).toBeDisabled()
    fill('Логин (для входа)', 'masha')
    fill('Имя (как увидят друзья)', 'Маша')
    fill('Стартовый PIN (4 цифры)', '12a3')
    expect(screen.getByLabelText('Стартовый PIN (4 цифры)')).toHaveValue('123') // только цифры
    expect(add).toBeDisabled()
    fill('Стартовый PIN (4 цифры)', '1234')
    expect(add).toBeEnabled()
    fill('Логин (для входа)', 'Маша') // кириллица — формат не проходит
    expect(add).toBeDisabled()
  })

  it('создание с полом: учетка, затем пол отдельным RPC, тост с логином и PIN, список перечитан', async () => {
    vi.mocked(adminCreateUser).mockResolvedValue({ id: 'u3' })
    await openAdd()
    fill('Логин (для входа)', 'Masha')
    fill('Имя (как увидят друзья)', 'Маша')
    fill('Стартовый PIN (4 цифры)', '2580')
    fill('Пол (для лидерборда)', 'f')
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(adminSetSex).toHaveBeenCalledWith('u3', 'f'))
    expect(adminCreateUser).toHaveBeenCalledWith('Маша', 'member', '2580', 'Masha')
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Участник добавлен', sub: 'Вход: логин masha, PIN 2580.' }))
    await waitFor(() => expect(adminListUsers).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Добавить' })).toBeNull()
  })

  it('пол не задан — второй RPC не зовется (холостой вызов затирал бы пол)', async () => {
    vi.mocked(adminCreateUser).mockResolvedValue({ id: 'u3' })
    await openAdd()
    fill('Логин (для входа)', 'petya')
    fill('Имя (как увидят друзья)', 'Петя')
    fill('Стартовый PIN (4 цифры)', '2580')
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(adminCreateUser).toHaveBeenCalled())
    await waitFor(() => expect(showToast).toHaveBeenCalled())
    expect(adminSetSex).not.toHaveBeenCalled()
  })

  it('ошибка создания — тост с причиной, форма остается, список перечитан', async () => {
    vi.mocked(adminCreateUser).mockRejectedValue(new Error('Логин занят'))
    await openAdd()
    fill('Логин (для входа)', 'dima')
    fill('Имя (как увидят друзья)', 'Дима 2')
    fill('Стартовый PIN (4 цифры)', '2580')
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось', sub: 'Логин занят' })))
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument()
    await waitFor(() => expect(adminListUsers).toHaveBeenCalledTimes(2))
  })
})

describe('UsersSection — сброс PIN', () => {
  it('новый PIN от сервера показывается у участника и прячется по ✕', async () => {
    vi.mocked(adminResetPin).mockResolvedValue('4821')
    render(<UsersSection meId="me" online errMsg={errMsg} />)
    await screen.findByText('Дима')
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить PIN' }))
    expect(await screen.findByText('4821')).toBeInTheDocument()
    expect(adminResetPin).toHaveBeenCalledWith('u2')
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }))
    expect(screen.queryByText('4821')).toBeNull()
  })

  it('офлайн — без запроса списка, кнопки действий неактивны', () => {
    render(<UsersSection meId="me" online={false} errMsg={errMsg} />)
    expect(adminListUsers).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '+ Добавить участника' })).toBeDisabled()
  })
})
