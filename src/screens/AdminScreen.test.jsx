// @vitest-environment jsdom
// Админка, раздел «Пользователи»: форма правки участника зовет RPC ТОЛЬКО по
// измененным полям. Регрессия 29.07.2026 — saveUser безусловно звал
// adminSetSex(id, edSex || null), и если серверный admin_list_users отдавал список
// без колонки sex, любая правка имени физически стирала пол в БД.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminScreen from './AdminScreen.jsx'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  adminListUsers, adminSetUser, adminSetPrivate, adminSetSex, adminUpdateExercise,
  adminDeleteUser,
  adminCreateInvite, adminListInvites, adminRevokeInvite,
} from '../lib/admin.js'

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
  adminDeleteUser: vi.fn(() => Promise.resolve()),
  adminSetUserOrder: vi.fn(),
  adminUpdateExercise: vi.fn(),
  adminMergeExercise: vi.fn(),
  adminListConnections: vi.fn(() => Promise.resolve([])),
  adminSetConnection: vi.fn(),
  adminCreateInvite: vi.fn(),
  adminListInvites: vi.fn(() => Promise.resolve([])),
  adminRevokeInvite: vi.fn(() => Promise.resolve(true)),
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
  vi.mocked(adminDeleteUser).mockClear()
  vi.mocked(adminListUsers).mockResolvedValue([DIMA])
})

describe('AdminScreen: правка участника', () => {
  it('«Сохранить» без изменений не зовет ни один RPC', async () => {
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

  it('смена только имени зовет только adminSetUser', async () => {
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Дмитрий')
    await user.click(save)

    await waitFor(() => expect(adminSetUser).toHaveBeenCalledWith('u1', 'Дмитрий', 'member'))
    expect(adminSetPrivate).not.toHaveBeenCalled()
    expect(adminSetSex).not.toHaveBeenCalled()
  })

  it('смена пола зовет adminSetSex с новым значением', async () => {
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.selectOptions(screen.getByLabelText('Пол (для лидерборда)'), 'f')
    await user.click(save)

    await waitFor(() => expect(adminSetSex).toHaveBeenCalledWith('u1', 'f'))
    expect(adminSetUser).not.toHaveBeenCalled()
  })

  it('сброс пола в «не задан» передается как null', async () => {
    const user = userEvent.setup()
    const save = await openDimaEdit(user)

    await user.selectOptions(screen.getByLabelText('Пол (для лидерборда)'), '')
    await user.click(save)

    await waitFor(() => expect(adminSetSex).toHaveBeenCalledWith('u1', null))
  })
})

describe('AdminScreen: удаление участника', () => {
  it('требует точное имя и после подтверждения зовет adminDeleteUser', async () => {
    const user = userEvent.setup()

    render(<AdminScreen user={ME} onBack={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Пользователи/ }))

    expect(await screen.findByText('Дима')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Удалить Дима' }))

    const confirm = screen.getByLabelText(/Для подтверждения введи имя/)
    const remove = screen.getByRole('button', { name: 'Удалить навсегда' })

    expect(remove).toBeDisabled()

    await user.type(confirm, 'Дим')
    expect(remove).toBeDisabled()

    await user.type(confirm, 'а')
    expect(remove).toBeEnabled()

    await user.click(remove)

    await waitFor(() => {
      expect(adminDeleteUser).toHaveBeenCalledTimes(1)
      expect(adminDeleteUser).toHaveBeenCalledWith('u1')
    })
  })

  it('не показывает удаление для текущего пользователя', async () => {
    vi.mocked(adminListUsers).mockResolvedValue([ME, DIMA])
    const user = userEvent.setup()

    render(<AdminScreen user={ME} onBack={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Пользователи/ }))

    expect(await screen.findByText('Саня')).toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'Удалить Саня' })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Удалить Дима' })
    ).toBeInTheDocument()
  })
})

// v6.3.6: тип упражнения меняет админ. p_metric уходит ТОЛЬКО при реальной смене —
// иначе обычная правка падала бы на сервере без admin-exercise-metric.sql.
describe('AdminScreen: тип упражнения', () => {
  const LEG = { id: 'e1', name: 'Подъем ног', muscle_group: 'пресс', submuscle: 'hip_flexors', secondary: [], metric: 'reps' }

  async function openLegEdit(user) {
    vi.mocked(useLiveQuery).mockReturnValue([LEG])
    render(<AdminScreen user={ME} onBack={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Справочник упражнений/ }))
    expect(screen.getByText(/повторения/)).toBeInTheDocument() // тип виден в строке списка
    await user.click(screen.getByRole('button', { name: 'Изменить' }))
  }

  beforeEach(() => vi.mocked(adminUpdateExercise).mockReset().mockResolvedValue({}))

  it('смена типа → adminUpdateExercise с metric', async () => {
    const user = userEvent.setup()
    await openLegEdit(user)
    expect(screen.getByRole('radio', { name: 'Только повторения' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'На время' }))
    expect(screen.getByText(/не пересчитываются/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(adminUpdateExercise).toHaveBeenCalledTimes(1))
    expect(vi.mocked(adminUpdateExercise).mock.calls[0][0]).toMatchObject({ id: 'e1', metric: 'time' })
  })

  it('без смены типа metric не отправляется', async () => {
    const user = userEvent.setup()
    await openLegEdit(user)
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(adminUpdateExercise).toHaveBeenCalledTimes(1))
    expect(vi.mocked(adminUpdateExercise).mock.calls[0][0].metric).toBeUndefined()
  })
})

// v6.8.0: приглашения. Ссылка показывается один раз — сразу после создания.
describe('AdminScreen: приглашения', () => {
  const TOKEN = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'
  const OPEN = { id: 'i1', note: 'Саша', status: 'ok', expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }
  const USED = { id: 'i2', note: null, status: 'used', used_by_name: 'Маша', used_at: '2026-10-01T10:00:00Z' }

  beforeEach(() => {
    vi.mocked(adminListInvites).mockReset().mockResolvedValue([OPEN, USED])
    vi.mocked(adminCreateInvite).mockReset().mockResolvedValue({ id: 'i3', token: TOKEN, expires_at: '2026-10-09T00:00:00Z' })
    vi.mocked(adminRevokeInvite).mockClear()
  })

  async function openInvites(user) {
    render(<AdminScreen user={ME} onBack={() => {}} />)
    await user.click(screen.getByRole('button', { name: /Приглашения/ }))
    expect(await screen.findByText('Саша')).toBeInTheDocument()
  }

  it('список со статусами; отозвать можно только живую', async () => {
    const user = userEvent.setup()
    await openInvites(user)
    expect(screen.getByText(/ждет/)).toBeInTheDocument()
    expect(screen.getByText(/Маша/)).toBeInTheDocument()
    const revoke = screen.getAllByRole('button', { name: 'Отозвать ссылку' })
    expect(revoke).toHaveLength(1)
    await user.click(revoke[0])
    await waitFor(() => expect(adminRevokeInvite).toHaveBeenCalledWith('i1'))
  })

  it('создание показывает полную ссылку с токеном', async () => {
    const user = userEvent.setup()
    await openInvites(user)
    await user.type(screen.getByLabelText(/Для кого/), 'Петя')
    await user.click(screen.getByRole('button', { name: 'Создать ссылку' }))
    await waitFor(() => expect(adminCreateInvite).toHaveBeenCalledWith('Петя'))
    const link = await screen.findByLabelText('Ссылка-приглашение')
    expect(link.value).toMatch(new RegExp(`#invite=${TOKEN}$`))
    await user.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.queryByLabelText('Ссылка-приглашение')).toBeNull()
  })
})
