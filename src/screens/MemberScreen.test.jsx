// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import MemberScreen from './MemberScreen.jsx'
import { fetchMember, toggleMemberReaction } from '../db/memberProfile.js'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/memberProfile.js', () => ({
  getCachedMember: vi.fn(),
  fetchMember: vi.fn(() => Promise.resolve(true)),
  toggleMemberReaction: vi.fn(() => Promise.resolve()),
}))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn(() => Promise.resolve()) }))
vi.mock('../db/repo.js', () => ({ getCachedUser: vi.fn() }))
vi.mock('../lib/appEvents.js', () => ({
  onOnline: vi.fn(() => () => {}),
  onResume: vi.fn(() => () => {}),
}))

const viewer = { id: 'me', name: 'Саня' }
const bench = (w, r) => ({ exercise_id: 'bench', name: 'Жим лежа', metric: 'weight', is_bench_lift: true, sets: [{ weight: w, reps: r }] })
const workout = (id, iso, entries, extra = {}) => ({
  id, user_id: 'dima', user_name: 'Дима', performed_at: iso, entries,
  exCount: entries.length, setCount: entries.reduce((n, e) => n + e.sets.length, 0), tonnage: 400, prs: [], ...extra,
})

function mockQueries(snap, roster = { id: 'dima', name: 'Дима', avatar_url: null }) {
  vi.mocked(useLiveQuery).mockImplementation((fn, deps) => {
    // порядок вызовов в экране: снимок, затем ростер
    return deps?.[0] === 'dima' && mockQueries.next++ % 2 === 0 ? snap : roster
  })
}
mockQueries.next = 0

describe('MemberScreen', () => {
  beforeEach(() => {
    vi.mocked(useLiveQuery).mockReset()
    vi.mocked(fetchMember).mockClear()
    mockQueries.next = 0
  })

  it('показывает статы, рекорды и последние тренировки участника', () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      workout(`w${i}`, new Date(Date.now() - i * 86400000).toISOString(), [bench(80 + i, 5)],
        i === 0 ? { prs: [{ name: 'Жим лежа', metric: 'weight', value: 80 }] } : {}))
    mockQueries({ at: 1, total: 42, items, source: 'cache' })
    render(<MemberScreen user={viewer} memberId="dima" onBack={() => {}} />)

    expect(screen.getByText('Дима')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('Рекорды')).toBeTruthy()
    expect(screen.getByText('86 кг')).toBeTruthy() // лучший жим из окна
    expect(screen.getAllByRole('article')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Показать еще' }))
    expect(screen.getAllByRole('article')).toHaveLength(7)
    expect(fetchMember).toHaveBeenCalledWith('me', 'dima')
  })

  it('снимок из ленты помечен как неполный', () => {
    mockQueries({ at: null, total: null, items: [workout('w1', new Date().toISOString(), [bench(70, 5)])], source: 'feed' })
    const { container } = render(<MemberScreen user={viewer} memberId="dima" onBack={() => {}} />)
    expect(container.querySelector('.stat-num').textContent).toBe('1+')
    expect(screen.getByText(/полный профиль подтянется/)).toBeTruthy()
  })

  it('реакции: счетчик на карточке и тап по своей реакции', () => {
    const items = [workout('w1', new Date().toISOString(), [bench(70, 5)], {
      reactions: [
        { user_id: 'kate', name: 'Катя', kind: 'fire' },
        { user_id: 'me', name: 'Саня', kind: 'fire' },
      ],
    })]
    mockQueries({ at: 1, total: 1, items, source: 'cache' })
    render(<MemberScreen user={viewer} memberId="dima" onBack={() => {}} />)
    const fire = screen.getByRole('button', { name: /🔥/ })
    expect(fire.getAttribute('aria-pressed')).toBe('true')
    expect(fire.textContent).toContain('2')
    fireEvent.click(fire)
    expect(toggleMemberReaction).toHaveBeenCalledWith({
      userId: 'me', userName: 'Саня', memberId: 'dima', workoutId: 'w1', kind: 'fire', mine: true,
    })
  })

  it('назад зовет onBack', () => {
    const onBack = vi.fn()
    mockQueries(null)
    render(<MemberScreen user={viewer} memberId="dima" onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(onBack).toHaveBeenCalled()
  })
})
