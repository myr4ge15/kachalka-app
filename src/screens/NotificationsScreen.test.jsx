// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import NotificationsScreen from './NotificationsScreen.jsx'
import { getSeenAt, markAllSeen } from '../db/notifications.js'

// Построение списка и счетчик — db/notifications.js и lib/notifFilter.js.
// useLiveQuery → синхронный вызов запроса: моки db отдают значения сразу.
const mocks = vi.hoisted(() => ({ list: undefined, roster: [] }))
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn, _deps, def) => { const v = fn(); return v === undefined ? def : v },
}))
vi.mock('../db/notifications.js', () => ({
  getNotifications: () => mocks.list,
  getSeenAt: vi.fn(),
  markAllSeen: vi.fn(),
}))
vi.mock('../db/repo.js', () => ({ getUsers: () => mocks.roster }))

const ME = { id: 'me' }
const N = {
  mine: { id: 'n1', type: 'mine', at: '2026-10-03T10:00:00Z', name: 'Жим лежа', metric: 'weight', value: 100, prev: 95 },
  goal: { id: 'n2', type: 'goal', at: '2026-10-02T10:00:00Z', name: 'Присед', metric: 'weight', value: 120 },
  react: { id: 'n3', type: 'reaction', at: '2026-10-01T10:00:00Z', who: 'Оля', whoId: 'olya', emojis: ['🔥', '💪'] },
  beaten: { id: 'n4', type: 'beaten', at: '2026-09-01T10:00:00Z', who: 'Петя', whoId: 'petya', name: 'Жим лежа', metric: 'weight', value: 105, myValue: 100 },
  insight: { id: 'n5', type: 'insight', at: '2026-08-01T10:00:00Z', text: 'Ты стабилен', emoji: '📈' },
  badge: { id: 'n6', type: 'badge', at: '2026-08-01T09:00:00Z', name: '10 тренировок', emoji: '🏅' },
}

const renderScreen = () => render(<NotificationsScreen user={ME} onBack={vi.fn()} />)

describe('NotificationsScreen', () => {
  beforeEach(() => {
    mocks.list = undefined
    mocks.roster = [{ id: 'me', sex: 'f' }, { id: 'olya', sex: 'f' }, { id: 'petya', sex: 'm' }]
    vi.mocked(getSeenAt).mockReset().mockResolvedValue('2026-09-15T00:00:00Z')
    vi.mocked(markAllSeen).mockReset()
  })

  it('загрузка — каркас, прочитанным ничего не помечаем', async () => {
    renderScreen()
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument()
    await waitFor(() => expect(getSeenAt).toHaveBeenCalled())
    expect(markAllSeen).not.toHaveBeenCalled()
  })

  it('пусто — «Пока тихо»', async () => {
    mocks.list = []
    renderScreen()
    expect(screen.getByText(/Пока тихо/)).toBeInTheDocument()
    await waitFor(() => expect(markAllSeen).toHaveBeenCalledTimes(1))
  })

  it('все типы: тексты с родом по полу, новые подсвечены относительно метки до открытия', async () => {
    mocks.list = Object.values(N)
    const { container } = renderScreen()
    await waitFor(() => expect(screen.getByText('3 новых')).toBeInTheDocument())
    expect(screen.getByText(/Новый максимум/)).toHaveTextContent('Новый максимум: 100 кг (прошлый — 95 кг)')
    expect(screen.getByText(/до цели/)).toHaveTextContent('Ты дотянула до цели')
    expect(screen.getByText(/твою тренировку/)).toHaveTextContent('Оценила твою тренировку: 🔥 💪')
    expect(screen.getByText(/тебя в «Жим лежа»/)).toHaveTextContent('Петя обошел тебя в «Жим лежа»: 105 кг (твой 100 кг)')
    expect(screen.getByText('Ты стабилен')).toBeInTheDocument()
    expect(screen.getByText('Бейдж получен 🎉')).toBeInTheDocument()
    expect(container.querySelectorAll('.notif.unread')).toHaveLength(3)
    expect(container.querySelectorAll('.n-dot')).toHaveLength(3)
    // Помечаем прочитанным один раз — по полному списку.
    expect(markAllSeen).toHaveBeenCalledTimes(1)
    expect(markAllSeen).toHaveBeenCalledWith('me', mocks.list)
  })

  it('фильтр-чипы: только присутствующие категории; выбор сужает список, не трогая счетчик', async () => {
    mocks.list = [N.mine, N.react, N.beaten]
    const { container } = renderScreen()
    await waitFor(() => expect(screen.getByText('2 новых')).toBeInTheDocument())
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['все', 'рекорды', 'побитые', 'реакции'])
    fireEvent.click(screen.getByRole('tab', { name: 'реакции' }))
    expect(screen.getByRole('tab', { name: 'реакции' })).toHaveAttribute('aria-selected', 'true')
    expect(container.querySelectorAll('.notif')).toHaveLength(1)
    expect(screen.getByText('2 новых')).toBeInTheDocument()
  })

  it('одна категория — чипов нет; без метки «прочитано» все новые', async () => {
    vi.mocked(getSeenAt).mockRejectedValue(new Error('нет'))
    mocks.list = [N.mine]
    renderScreen()
    await waitFor(() => expect(markAllSeen).toHaveBeenCalled())
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText('1 новое')).toBeInTheDocument()
  })
})
