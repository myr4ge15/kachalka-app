// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import Leaderboard from './Leaderboard.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/leaderboard.js', () => ({
  getCachedLeaderboard: vi.fn(),
  fetchLeaderboard: vi.fn(() => Promise.resolve()),
  getLeadExerciseNames: vi.fn(),
  viewerBoard: (sex) => sex === 'f' ? 'f' : 'm',
}))
vi.mock('../db/repo.js', () => ({ getUsers: vi.fn(), getCachedUser: vi.fn() }))
vi.mock('../db/local.js', () => ({ getMeta: vi.fn() }))
vi.mock('../lib/appEvents.js', () => ({
  onOnline: vi.fn(() => () => {}),
  onResume: vi.fn(() => () => {}),
}))

const user = { id: 'me', name: 'Саня' }
const male = [
  { user_id: 'dima', user_name: 'Дима', weight: 100, reps: 5, orm: 117 },
  { user_id: 'me', user_name: 'Саня', weight: 95, reps: 6, orm: 114 },
]

function readyQueries({ privateUser = false, rows = male } = {}) {
  vi.mocked(useLiveQuery)
    .mockReturnValueOnce(privateUser)
    .mockReturnValueOnce({ male: rows, female: [] })
    .mockReturnValueOnce({ male: 'жим лежа', female: 'ягодичный мостик' })
    .mockReturnValueOnce([
      { id: 'me', avatar_url: null },
      { id: 'dima', avatar_url: null },
    ])
    .mockReturnValueOnce({ id: 'me', sex: 'm' })
}

describe('Leaderboard rivalry', () => {
  beforeEach(() => vi.mocked(useLiveQuery).mockReset())

  it('показывает ориентир из текущего борда над рейтингом', () => {
    readyQueries()
    render(<Leaderboard user={user} />)

    expect(screen.getByRole('region', { name: 'Ближайший ориентир' })).toBeInTheDocument()
    expect(screen.getByText('До Дима — 5 кг')).toBeInTheDocument()
    expect(screen.getByText('Рейтинг · жим лежа')).toBeInTheDocument()
  })

  it('не показывает ни рейтинг, ни ориентир приватному пользователю', () => {
    readyQueries({ privateUser: true })
    render(<Leaderboard user={user} />)

    expect(screen.queryByLabelText('Ближайший ориентир')).not.toBeInTheDocument()
    expect(screen.queryByText(/Рейтинг ·/)).not.toBeInTheDocument()
  })

  it('не добавляет карточку, если пользователя нет в устаревшем кэше', () => {
    readyQueries({ rows: [male[0], { ...male[1], user_id: 'other' }] })
    render(<Leaderboard user={user} />)

    expect(screen.queryByLabelText('Ближайший ориентир')).not.toBeInTheDocument()
    expect(screen.getByText('Рейтинг · жим лежа')).toBeInTheDocument()
  })
})

describe('Leaderboard — пустой борд офлайн (v6.5.1)', () => {
  beforeEach(() => vi.mocked(useLiveQuery).mockReset())

  it('офлайн и пустой кэш — «обновится, когда появится сеть», а не «запиши подход»', () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    readyQueries({ rows: [] })
    render(<Leaderboard user={user} />)
    expect(screen.getByText('Рейтинг обновится, когда появится сеть.')).toBeInTheDocument()
    expect(screen.queryByText(/запиши подход/)).toBeNull()
    online.mockRestore()
  })

  it('онлайн и пустой свой борд — по-прежнему «запиши подход»', () => {
    readyQueries({ rows: [] })
    render(<Leaderboard user={user} />)
    expect(screen.getByText(/Пока нет данных — запиши подход в жиме лежа/)).toBeInTheDocument()
  })
})
