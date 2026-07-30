// @vitest-environment jsdom
// Админка, раздел «Пользователи»: форма правки участника зовёт RPC ТОЛЬКО по
// изменённым полям. Регрессия 29.07.2026 — saveUser безусловно звал
// adminSetSex(id, edSex || null), и если серверный admin_list_users отдавал список
// без колонки sex, любая правка имени физически стирала пол в БД.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminScreen from './AdminScreen.jsx'
import { adminListUsers, adminSetUser, adminSetPrivate, adminSetSex } from '../lib/admin.js'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn(() => []) }))
vi.mock('../db/repo.js', () => ({ getAllExercisesForAdmin: vi.fn(() => Promise.resolve([])) }))
vi.mock('../db/sync.js', () => ({ useSyncStatus: () => ({ online: true }) }))
vi.mock('../components/Toast.jsx', () => ({ showToast: vi.fn() }))
vi.mock('../lib/admin.js', () => ({
  AdminError: class AdminError extends Error {},
  adminListUsers: vi.fn(),
  adminSetUser: vi.fn(() => Promise.resolve()),
  adminSetPrivate: vi.fn(() => Promise.resolve()),
  adminSetSex: vi.fn(() => Promise.resolve()),
  adminResetPin: vi.fn(),
  adminCreateUser: vi.fn(),
  adminSetUserOrder: vi.fn(),
  adminUpdateExercise: vi.fn(),
  adminMergeExercise: vi.fn(),
  adminListConnections: vi.fn(() => Promise.resolve([])),
  adminSetConnection: vi.fn(),
}))

const ME = { id: 'me', name: 'Саня', role: 'admin' }
const DIMA = { id: 'u1', name: 'Дима', role: 'member', is_private: false, sex: 'm', sort_order: 1 }

// Раскрыть «Пользователи» и войти в правку Димы.
async function openDimaEdit(user) {
  render(<AdminScreen user={ME} onBack={() => {}} />)
  await user.click(screen.getByRole('button', { name: /Пользователи/ }))
  expect(await screen.findByText('Дима')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Изменить' }))
  return screen.getByRole('button', { name: 'Сохранить' })
}

beforeEach(() => {
  vi.mocked(adminSetUser).mockClear()
  vi.mocked(adminSetPrivate).mockClear()
  vi.mocked(adminSetSex).mockClear()
  vi.mocked(adminListUsers).mockResolvedValue([DIMA])
})

describe('AdminScreen: правка участника', () => {
  it('«Сохранить» без изменений не зовёт ни один RPC', async () => {
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.click(save)

    await waitFor(() => expect(adminListUsers).toHaveBeenCalledTimes(2)) // reload после сохранения
    expect(adminSetUser).not.toHaveBeenCalled()
    expect(adminSetPrivate).not.toHaveBeenCalled()
    expect(adminSetSex).not.toHaveBeenCalled()
  })

  it('участник БЕЗ поля sex в ответе сервера: пол не затирается (кейс инцидента)', async () => {
    // Старый контракт admin_list_users — колонки sex в ответе нет.
    const { sex, ...noSex } = DIMA
    vi.mocked(adminListUsers).mockResolvedValue([noSex])
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Дмитрий')
    await user.click(save)

    await waitFor(() => expect(adminSetUser).toHaveBeenCalledWith('u1', 'Дмитрий', 'member'))
    expect(adminSetSex).not.toHaveBeenCalled()
  })

  it('смена только имени зовёт только adminSetUser', async () => {
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Дмитрий')
    await user.click(save)

    await waitFor(() => expect(adminSetUser).toHaveBeenCalledWith('u1', 'Дмитрий', 'member'))
    expect(adminSetPrivate).not.toHaveBeenCalled()
    expect(adminSetSex).not.toHaveBeenCalled()
  })

  it('смена пола зовёт adminSetSex с новым значением', async () => {
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.selectOptions(screen.getByLabelText('Пол (для лидерборда)'), 'f')
    await user.click(save)

    await waitFor(() => expect(adminSetSex).toHaveBeenCalledWith('u1', 'f'))
    expect(adminSetUser).not.toHaveBeenCalled()
  })

  it('сброс пола в «не задан» передаётся как null', async () => {
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.selectOptions(screen.getByLabelText('Пол (для лидерборда)'), '')
    await user.click(save)

    await waitFor(() => expect(adminSetSex).toHaveBeenCalledWith('u1', null))
  })
})
