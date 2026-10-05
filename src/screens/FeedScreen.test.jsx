// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FeedScreen from './FeedScreen.jsx'
import { fetchFeed } from '../db/feed.js'
import { toggleReaction } from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import { vibrate } from '../lib/haptics.js'
import { emitReselect } from '../lib/appEvents.js'

// Склейка экрана: кэш → карточки, обновление (вход/повтор вкладки/жест/кнопка),
// реакции, приватный режим. Данные витрины — db/feed.js (свои тесты).
const mocks = vi.hoisted(() => ({ feed: undefined, users: [], priv: false }))
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn, _deps, def) => { const v = fn(); return v === undefined ? def : v },
}))
vi.mock('../db/feed.js', () => ({ getCachedFeed: () => mocks.feed, fetchFeed: vi.fn() }))
vi.mock('../db/repo.js', () => ({
  getUsers: () => mocks.users,
  getPrivacyFlag: () => mocks.priv,
  toggleReaction: vi.fn(),
}))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../lib/haptics.js', () => ({ vibrate: vi.fn(), HAPTIC: { tap: 10 } }))
vi.mock('./Leaderboard.jsx', () => ({ default: () => <div data-testid="leaderboard" /> }))

const ME = { id: 'me', name: 'Саня' }
const post = (over) => ({
  id: 'w1', user_id: 'petya', user_name: 'Петя', performed_at: '2026-10-04T18:00:00Z',
  entries: [{ exercise_id: 'bench', name: 'Жим лежа', metric: 'weight', sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }] }],
  exCount: 1, setCount: 2, tonnage: 800, reactions: [], prs: [], ...over,
})

let online
function renderFeed(props = {}) {
  const onOpenMember = vi.fn()
  const utils = render(<div className="content"><FeedScreen user={ME} onOpenMember={onOpenMember} {...props} /></div>)
  return { ...utils, onOpenMember }
}

describe('FeedScreen', () => {
  beforeEach(() => {
    mocks.feed = undefined
    mocks.users = [{ id: 'me', name: 'Саня' }, { id: 'petya', avatar_url: null }]
    mocks.priv = false
    online = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    vi.mocked(fetchFeed).mockReset().mockResolvedValue()
    vi.mocked(toggleReaction).mockReset().mockResolvedValue()
    vi.mocked(syncNow).mockReset()
    vi.mocked(vibrate).mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('кэша еще нет — каркас; при входе тянет свежую ленту и пишет «обновлено»', async () => {
    renderFeed()
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument()
    expect(fetchFeed).toHaveBeenCalledWith('me')
    expect(await screen.findByText(/^обновлено /)).toBeInTheDocument()
    expect(screen.getByTestId('leaderboard')).toBeInTheDocument()
  })

  it('карточка: автор, подходы, итоги, подсветка из пуша; тап по шапке — профиль с якорем', async () => {
    mocks.feed = [post({ prs: [] }), post({ id: 'w2', user_id: 'me', user_name: 'Саня' })]
    const { container, onOpenMember } = renderFeed({ flashId: 'w2' })
    await waitFor(() => expect(fetchFeed).toHaveBeenCalled())
    expect(screen.getAllByText('80×5, 80×5')).toHaveLength(2)
    expect(screen.getAllByText('1 упр. · 2 подх. · 800 кг тоннаж')).toHaveLength(2)
    expect(container.querySelectorAll('.feed-card--flash')).toHaveLength(1)
    expect(screen.getByText('я')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть профиль: Петя' }))
    expect(onOpenMember).toHaveBeenCalledWith('petya', 'feed-w1')
    expect(screen.getByRole('button', { name: 'Открыть мой профиль' })).toBeInTheDocument()
  })

  it('реакция на чужую тренировку: вибро, очередь с моим именем, синк при сети', async () => {
    mocks.feed = [post()]
    renderFeed()
    fireEvent.click(screen.getByRole('button', { name: /🔥/ }))
    expect(vibrate).toHaveBeenCalled()
    expect(toggleReaction).toHaveBeenCalledWith({ userId: 'me', userName: 'Саня', workoutId: 'w1', kind: 'fire', mine: false })
    await waitFor(() => expect(syncNow).toHaveBeenCalledWith('me'))
  })

  it('снятие своей реакции — без вибро; офлайн — без синка', async () => {
    online = false
    mocks.feed = [post({ reactions: [{ user_id: 'me', name: 'Саня', kind: 'clap' }] })]
    renderFeed()
    fireEvent.click(screen.getByRole('button', { name: /👏/ }))
    await waitFor(() => expect(toggleReaction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'clap', mine: true })))
    expect(vibrate).not.toHaveBeenCalled()
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('офлайн без кэша — объяснение, к серверу не ходим; с кэшем — молча показываем кэш', () => {
    online = false
    mocks.feed = []
    const { unmount } = renderFeed()
    expect(screen.getByText(/Лента недоступна офлайн/)).toBeInTheDocument()
    expect(fetchFeed).not.toHaveBeenCalled()
    unmount()
    mocks.feed = [post()]
    renderFeed()
    expect(screen.queryByText(/недоступна офлайн/)).toBeNull()
  })

  it('ошибка обновления — баннер; кнопка «Обновить» повторяет', async () => {
    vi.mocked(fetchFeed).mockRejectedValueOnce(new Error('503'))
    mocks.feed = []
    renderFeed()
    expect(await screen.findByText('Не удалось обновить ленту: 503')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить ленту' }))
    await waitFor(() => expect(screen.queryByText(/Не удалось обновить/)).toBeNull())
    expect(fetchFeed).toHaveBeenCalledTimes(2)
  })

  it('пустая лента: обычному — «Будь первым», приватному — свой текст и без рейтинга', () => {
    mocks.feed = []
    const { unmount } = renderFeed()
    expect(screen.getByText(/Будь первым/)).toBeInTheDocument()
    unmount()
    mocks.priv = true
    renderFeed()
    expect(screen.getByText(/Попроси админа добавить друзей/)).toBeInTheDocument()
    expect(screen.getByText(/Приватный режим/)).toBeInTheDocument()
    expect(screen.queryByTestId('leaderboard')).toBeNull()
  })

  it('рейтинг свернут по умолчанию; раскрытие запоминается для учетки', () => {
    localStorage.clear()
    mocks.feed = []
    const { container, unmount } = renderFeed()
    const toggle = screen.getByRole('button', { name: 'Рейтинг' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.feed-rail')).toHaveAttribute('data-open', '0')
    expect(screen.getByTestId('leaderboard')).toBeInTheDocument() // смонтирован, просто скрыт CSS
    fireEvent.click(toggle)
    expect(container.querySelector('.feed-rail')).toHaveAttribute('data-open', '1')
    unmount()
    renderFeed()
    expect(screen.getByRole('button', { name: 'Рейтинг' })).toHaveAttribute('aria-expanded', 'true')
    localStorage.clear()
  })

  it('повторный тап по вкладке «Лента» обновляет; по другой вкладке — нет', async () => {
    mocks.feed = []
    renderFeed()
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1))
    await act(async () => { emitReselect('home') })
    expect(fetchFeed).toHaveBeenCalledTimes(1)
    await act(async () => { emitReselect('feed') })
    expect(fetchFeed).toHaveBeenCalledTimes(2)
  })

  it('pull-to-refresh у верха: дотянул до порога — обновление с вибро; не дотянул — нет', async () => {
    mocks.feed = [post()]
    const { container } = renderFeed()
    await waitFor(() => expect(screen.getByText(/^обновлено /)).toBeInTheDocument())
    const sc = container.querySelector('.content')
    const pull = (dy) => {
      fireEvent.touchStart(sc, { touches: [{ clientY: 100 }] })
      fireEvent.touchMove(sc, { touches: [{ clientY: 100 + dy }] })
      fireEvent.touchEnd(sc)
    }
    pull(40)
    expect(fetchFeed).toHaveBeenCalledTimes(1)
    await act(async () => { pull(400) })
    expect(fetchFeed).toHaveBeenCalledTimes(2)
    expect(vibrate).toHaveBeenCalled()
  })
})
