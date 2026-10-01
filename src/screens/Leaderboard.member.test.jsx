// @vitest-environment jsdom
// Отдельный файл, чтобы не трогать Leaderboard.test.jsx (параллельная работа).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('Leaderboard — переход в профиль участника (v6.7.0)', () => {
  beforeEach(() => vi.mocked(useLiveQuery).mockReset())

  it('тап по строке рейтинга открывает профиль этого участника', () => {
    const onOpenMember = vi.fn()
    readyQueries()
    render(<Leaderboard user={user} onOpenMember={onOpenMember} />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть профиль: Дима' }))
    expect(onOpenMember).toHaveBeenCalledWith('dima', 'lb-dima')
  })

  it('Enter на строке тоже открывает профиль', () => {
    const onOpenMember = vi.fn()
    readyQueries()
    render(<Leaderboard user={user} onOpenMember={onOpenMember} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Открыть мой профиль' }), { key: 'Enter' })
    expect(onOpenMember).toHaveBeenCalledWith('me', 'lb-me')
  })

  it('без обработчика строки не притворяются кнопками', () => {
    readyQueries()
    render(<Leaderboard user={user} />)
    expect(screen.queryByRole('button', { name: /Открыть профиль/ })).toBeNull()
  })
})
