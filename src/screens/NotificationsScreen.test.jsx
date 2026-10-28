// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import NotificationsScreen from './NotificationsScreen.jsx'
import { getSeenAt, markAllSeen } from '../db/notifications.js'
import { syncNow } from '../db/sync.js'
import { myUnreadReplies } from '../lib/feedbackApi.js'

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
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn(async () => true) }))
vi.mock('../lib/feedbackApi.js', () => ({ myUnreadReplies: vi.fn(async () => 0) }))
vi.mock('../lib/haptics.js', () => ({ vibrate: vi.fn(), HAPTIC: { tap: 10 } }))

const ME = { id: 'me' }
const N = {
  mine: { id: 'n1', type: 'mine', at: '2026-10-03T10:00:00Z', name: 'Жим лежа', metric: 'weight', value: 100, prev: 95 },
  goal: { id: 'n2', type: 'goal', at: '2026-10-02T10:00:00Z', name: 'Присед', metric: 'weight', value: 120 },
  react: { id: 'n3', type: 'reaction', at: '2026-10-01T10:00:00Z', who: 'Оля', whoId: 'olya', emojis: ['🔥', '💪'] },
  beaten: { id: 'n4', type: 'beaten', at: '2026-09-01T10:00:00Z', who: 'Петя', whoId: 'petya', name: 'Жим лежа', metric: 'weight', value: 105, myValue: 100 },
  insight: { id: 'n5', type: 'insight', at: '2026-08-01T10:00:00Z', text: 'Ты стабилен', emoji: '📈' },
  badge: { id: 'n6', type: 'badge', at: '2026-08-01T09:00:00Z', name: '10 тренировок', emoji: '🏅' },
}
const CM = [
  { id: 'comment:c1', type: 'comment', mode: 'comment', at: '2026-10-05T10:00:00Z', who: 'Оля', whoId: 'olya', text: 'мощно' },
  { id: 'comment:c2', type: 'comment', mode: 'reply', at: '2026-10-05T09:00:00Z', who: 'Петя', whoId: 'petya', text: 'спасибо' },
  { id: 'creact:c3:petya', type: 'comment_react', at: '2026-10-05T08:00:00Z', who: 'Петя', whoId: 'petya', emoji: '🔥', text: 'сотка' },
]
const FB = { id: 'feedback:f1', type: 'feedback', feedbackId: 'f1', at: '2026-10-04T10:00:00Z', status: 'resolved', text: '', photos: 1 }

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

  it('комментарии, ответы и реакции на комментарии (26.10.2026, fb_76d747a2)', async () => {
    mocks.list = CM
    renderScreen()
    expect(await screen.findByText(/Комментарий к тренировке/)).toHaveTextContent('Комментарий к тренировке · Оля')
    expect(screen.getByText('«мощно»')).toBeInTheDocument()
    expect(screen.getByText(/Ответ на комментарий/)).toHaveTextContent('Ответ на комментарий · Петя')
    expect(screen.getByText(/твой комментарий/)).toHaveTextContent('Оценил твой комментарий: 🔥 «сотка»')
    expect(screen.getByRole('button', { name: 'комментарии' })).toBeInTheDocument()
  })

  it('тап по комментарию и реакции ведет в Ленту к тренировке; рекорд — не ссылка (fb_9c8b8517, fb_2277554b)', async () => {
    mocks.list = [{ ...CM[0], workoutId: 'w1' }, { ...CM[2], workoutId: 'w3', commentId: 'c3' }, { ...N.react, workoutId: 'w2' }, N.mine]
    const onOpenWorkout = vi.fn()
    render(<NotificationsScreen user={ME} onBack={vi.fn()} onOpenWorkout={onOpenWorkout} />)
    fireEvent.click(await screen.findByRole('button', { name: /Комментарий к тренировке/ }))
    expect(onOpenWorkout).toHaveBeenLastCalledWith('w1', true)
    fireEvent.click(screen.getByRole('button', { name: /Реакция на комментарий/ }))
    expect(onOpenWorkout).toHaveBeenLastCalledWith('w3', 'c3') // ветка — на этом комментарии
    fireEvent.click(screen.getByRole('button', { name: /Реакция на тренировку/ }))
    expect(onOpenWorkout).toHaveBeenLastCalledWith('w2', false)
    expect(screen.queryByRole('button', { name: /Личный рекорд/ })).toBeNull()
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
    // Помечаем прочитанным один раз — по полному списку. Пометка — в эффекте после
    // рендера: ждем ее, а не проверяем сразу (на нагруженном CI эффект мог не успеть).
    await waitFor(() => expect(markAllSeen).toHaveBeenCalledTimes(1))
    expect(markAllSeen).toHaveBeenCalledWith('me', mocks.list)
  })

  it('фильтр-чипы: только присутствующие категории; выбор сужает список, не трогая счетчик', async () => {
    mocks.list = [N.mine, N.react, N.beaten]
    const { container } = renderScreen()
    await waitFor(() => expect(screen.getByText('2 новых')).toBeInTheDocument())
    const tabs = within(screen.getByRole('group', { name: 'Фильтр уведомлений' })).getAllByRole('button').map((t) => t.textContent)
    expect(tabs).toEqual(['все', 'рекорды', 'побитые', 'реакции'])
    fireEvent.click(screen.getByRole('button', { name: 'реакции' }))
    expect(screen.getByRole('button', { name: 'реакции' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('.notif')).toHaveLength(1)
    expect(screen.getByText('2 новых')).toBeInTheDocument()
  })

  it('ответ разработчика (v6.12.0): своя категория, текст или пометка скриншота, ведет в обращение', async () => {
    mocks.list = [FB, N.mine]
    const onOpenFeedback = vi.fn()
    render(<NotificationsScreen user={ME} onBack={vi.fn()} onOpenFeedback={onOpenFeedback} />)
    expect(await screen.findByText('Ответ разработчика · решено')).toBeInTheDocument()
    expect(screen.getByText('📎 Ответ со скриншотом')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Фильтр уведомлений' })).getAllByRole('button').map((t) => t.textContent)).toEqual(['все', 'рекорды', 'ответы'])
    fireEvent.click(screen.getByRole('button', { name: 'Открыть обращение' }))
    expect(onOpenFeedback).toHaveBeenCalledWith('f1')
  })

  it('одна категория — чипов нет; без метки «прочитано» все новые', async () => {
    vi.mocked(getSeenAt).mockRejectedValue(new Error('нет'))
    mocks.list = [N.mine]
    renderScreen()
    await waitFor(() => expect(markAllSeen).toHaveBeenCalled())
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText('1 новое')).toBeInTheDocument()
  })
  it('потянуть вниз у верха — синк и ответы на обращения; не дотянул — ничего (fb_fd2caf4e)', async () => {
    mocks.list = [N.mine]
    vi.mocked(syncNow).mockClear(); vi.mocked(myUnreadReplies).mockClear()
    const { container } = render(<div className="content"><NotificationsScreen user={ME} onBack={vi.fn()} /></div>)
    await screen.findByText(/Жим лежа/)
    const sc = container.querySelector('.content')
    const pull = (dy) => {
      fireEvent.touchStart(sc, { touches: [{ clientY: 100, clientX: 50 }] })
      fireEvent.touchMove(sc, { touches: [{ clientY: 100 + dy, clientX: 50 }] })
      fireEvent.touchEnd(sc)
    }
    pull(40)
    expect(syncNow).not.toHaveBeenCalled()
    await act(async () => { pull(400) })
    expect(syncNow).toHaveBeenCalledWith('me')
    expect(myUnreadReplies).toHaveBeenCalledWith('me')
  })
})
