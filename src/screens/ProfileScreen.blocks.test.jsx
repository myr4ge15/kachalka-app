// @vitest-environment jsdom
// Поведение блоков Профиля (v6.14.1): зафиксировано ДО разбивки экрана на
// components/profile/* и проверяется после нее — перенос без изменения поведения.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import ProfileScreen from './ProfileScreen.jsx'
import * as repo from '../db/repo.js'
import * as auth from '../lib/auth.js'
import * as notifications from '../db/notifications.js'
import * as backup from '../db/backup.js'

// Живой useLiveQuery на моках: зовет fn после маунта и при смене deps.
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn, deps = [], fallback) => {
    const [v, setV] = useState(fallback)
    useEffect(() => {
      let alive = true
      Promise.resolve(fn()).then((x) => { if (alive) setV(x) }, () => {})
      return () => { alive = false }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
    return v
  },
}))
vi.mock('../hooks/usePushToggle.js', () => ({ usePushToggle: () => ({ availability: 'unsupported' }) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../components/Toast.jsx', () => ({ showToast: vi.fn() }))
vi.mock('../components/MemberInvites.jsx', () => ({ default: () => null }))
vi.mock('../lib/feedbackApi.js', () => ({ myUnreadReplies: vi.fn(async () => 0) }))
vi.mock('../db/leaderboard.js', () => ({ getCachedLeaderboard: vi.fn(async () => ({})) }))
vi.mock('../lib/avatar.js', () => ({ uploadMyAvatar: vi.fn() }))
vi.mock('../db/backup.js', () => ({ exportAllMyData: vi.fn(async () => 3), importAllMyData: vi.fn() }))
vi.mock('../db/notifications.js', () => ({ readGoals: vi.fn(async () => []), writeGoals: vi.fn(async () => {}) }))
vi.mock('../db/repo.js', () => ({
  getWorkouts: vi.fn(async () => []),
  getCachedUser: vi.fn(async () => ({ id: 'me', name: 'Тест', sex: null })),
  setCachedAvatar: vi.fn(), setCachedName: vi.fn(async () => {}), setCachedSex: vi.fn(),
  softDeleteMyWorkouts: vi.fn(async () => 2),
  deadLetterCount: vi.fn(async () => 0),
  retryDeadLetter: vi.fn(async () => 1),
  discardDeadLetter: vi.fn(async () => 1),
  getProgSettings: vi.fn(async () => ({ enabled: true })),
  setProgEnabled: vi.fn(),
  getPrivacyFlag: vi.fn(async () => false),
}))
vi.mock('../lib/auth.js', async (orig) => {
  const real = await orig()
  return {
    ...real, setPin: vi.fn(async () => true), setName: vi.fn(async (_id, n) => n), setSex: vi.fn(),
    getMyLogin: vi.fn(async () => 'dima'), setMyLogin: vi.fn(async (_id, l) => l.trim().toLowerCase()),
  }
})

const BENCH = { id: 'ex1', name: 'Жим лежа', muscle_group: 'грудь', metric: 'weight', is_bench_lift: true }
const WORKOUT = {
  id: 'w1', user_id: 'me', performed_at: '2026-10-01T10:00:00Z',
  entries: [{ exercise_id: 'ex1', exercise: BENCH, sets: [{ weight: 80, reps: 5 }] }],
}

function Harness(props) {
  const contentRef = useRef(null)
  return (
    <main className="content" ref={contentRef}>
      <ProfileScreen user={{ id: 'me', name: 'Тест', role: 'member' }} contentRef={contentRef} {...props} />
    </main>
  )
}
const openSettings = async () => fireEvent.click(await screen.findByRole('button', { name: 'Настройки' }))

beforeEach(() => { Element.prototype.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => vi.clearAllMocks())

// П4 (07.10.2026): логин виден и меняется в Настройках.
describe('Профиль: логин для входа', () => {
  it('показывает свой логин и меняет его', async () => {
    render(<Harness />)
    await openSettings()
    const row = await screen.findByRole('button', { name: /Логин для входа/ })
    await waitFor(() => expect(row).toHaveTextContent('dima'))
    fireEvent.click(row)
    const input = screen.getByLabelText('Новый логин')
    expect(input.value).toBe('dima')
    fireEvent.change(input, { target: { value: 'Dima.K' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(auth.setMyLogin).toHaveBeenCalledWith('me', 'Dima.K'))
    expect(await screen.findByRole('button', { name: /Логин для входа/ })).toHaveTextContent('dima.k')
  })
  it('занят — ошибка в форме', async () => {
    vi.mocked(auth.setMyLogin).mockRejectedValueOnce(new auth.LoginError('taken', 'Этот логин занят — придумай другой.'))
    render(<Harness />)
    await openSettings()
    fireEvent.click(await screen.findByRole('button', { name: /Логин для входа/ }))
    fireEvent.change(screen.getByLabelText('Новый логин'), { target: { value: 'masha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('занят')
  })
})

describe('Профиль: смена PIN', () => {
  it('проверки формы и успешная смена', async () => {
    render(<Harness />)
    await openSettings()
    fireEvent.click(screen.getByRole('button', { name: '🔑 Сменить PIN' }))
    const cur = screen.getByLabelText('Текущий PIN')
    const next = screen.getByLabelText('Новый PIN')
    const rpt = screen.getByLabelText('Повтор нового PIN')
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Сменить PIN' }))

    fireEvent.change(cur, { target: { value: '4826' } })
    fireEvent.change(next, { target: { value: '1234' } })
    fireEvent.change(rpt, { target: { value: '1234' } })
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/простой PIN/)

    fireEvent.change(next, { target: { value: '5091' } })
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/не совпадают/)

    fireEvent.change(rpt, { target: { value: '5091' } })
    submit()
    await waitFor(() => expect(auth.setPin).toHaveBeenCalledWith('me', '4826', '5091'))
    await waitFor(() => expect(screen.queryByLabelText('Текущий PIN')).toBeNull())
  })
})

describe('Профиль: застрявшие изменения', () => {
  it('предупреждение и в Профиле, и в Настройках; повтор и отклонение', async () => {
    vi.mocked(repo.deadLetterCount).mockResolvedValue(2)
    render(<Harness />)
    expect(await screen.findByText(/Не удалось отправить изменений: 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '🔄 Повторить отправку' }))
    await waitFor(() => expect(repo.retryDeadLetter).toHaveBeenCalled())

    await openSettings()
    const settings = screen.getByRole('heading', { name: 'Настройки' }).closest('.settings-screen')
    expect(await within(settings).findByText(/Не удалось отправить изменений: 2/)).toBeInTheDocument()
    fireEvent.click(within(settings).getByRole('button', { name: 'Отклонить' }))
    fireEvent.click(within(settings).getByRole('button', { name: 'Да, отклонить (потерять правки)' }))
    await waitFor(() => expect(repo.discardDeadLetter).toHaveBeenCalled())
  })
})

describe('Профиль: данные', () => {
  it('выгрузка, удаление с подтверждением', async () => {
    render(<Harness />)
    await openSettings()
    fireEvent.click(screen.getByRole('button', { name: /Скачать все мои данные/ }))
    await waitFor(() => expect(backup.exportAllMyData).toHaveBeenCalledWith('me', expect.any(String)))
    fireEvent.click(screen.getByRole('button', { name: '🗑 Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))
    await waitFor(() => expect(repo.softDeleteMyWorkouts).toHaveBeenCalledWith('me'))
  })
})

describe('Профиль: имя', () => {
  it('правка имени сохраняется и сообщается наверх', async () => {
    const onRenamed = vi.fn()
    render(<Harness onRenamed={onRenamed} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить имя' }))
    fireEvent.change(screen.getByLabelText('Новое имя'), { target: { value: 'Саня' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(auth.setName).toHaveBeenCalledWith('me', 'Саня'))
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith('Саня'))
  })
})

describe('Профиль: цели', () => {
  it('новая цель — дефолт «чуть выше рекорда», уходит в writeGoals', async () => {
    vi.mocked(repo.getWorkouts).mockResolvedValue([WORKOUT])
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Поставить цель' }))
    expect(screen.getByLabelText('Целевой вес в килограммах')).toHaveValue('85')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(notifications.writeGoals).toHaveBeenCalled())
    const [uid, list] = vi.mocked(notifications.writeGoals).mock.calls[0]
    expect(uid).toBe('me')
    expect(list).toEqual([expect.objectContaining({ exerciseId: 'ex1', metric: 'weight', targetWeight: 85, targetReps: null, _dirty: 1 })])
  })
})
