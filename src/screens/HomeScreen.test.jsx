// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import HomeScreen from './HomeScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/insights.js', () => ({ getHomeData: vi.fn() }))

const user = { id: 'u1', name: 'Саня' }
const scrollIntoView = vi.fn()
const readyHome = {
  summary: {
    hasData: true,
    tonnage: { month: 1000, pct: 10 },
    lastWorkout: { daysAgo: 1, tags: [] },
    streak: 2,
    workoutsThisMonth: 3,
    latestPr: null,
    nearestGoal: null,
    rhythm: Array.from({ length: 8 }, (_, i) => ({
      key: `2026-0${i + 1}-06`,
      start: i === 7 ? '2026-07-27' : `2026-0${i + 1}-06`,
      end: i === 7 ? '2026-08-02' : `2026-0${i + 1}-12`,
      current: i === 7,
      count: i === 7 ? 1 : 0,
      days: Array.from({ length: 7 }, (_, d) => ({
        day: i === 7 ? `2026-07-${String(27 + d).padStart(2, '0')}` : `2026-0${i + 1}-${String(6 + d).padStart(2, '0')}`,
        count: i === 7 && d === 2 ? 1 : 0,
        tags: i === 7 && d === 2 ? ['chest_middle'] : [],
        today: i === 7 && d === 3,
        future: i === 7 && d > 3,
      })),
    })),
  },
  insights: [{
    id: 'past',
    kind: 'past-self',
    exerciseId: 'bench',
    emoji: '💪',
    tone: 'good',
    text: 'Жим лёжа: 70 → 85 кг при 6 повт. — +21% за год',
  }],
  freshness: { recovery: [] },
}

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.mocked(useLiveQuery).mockReset()
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    })
  })

  it('показывает инсайт «себя прошлого» и ведёт в Прогресс', () => {
    vi.mocked(useLiveQuery).mockReturnValue(readyHome)
    const onNavigate = vi.fn()
    const onOpenProgress = vi.fn()
    render(<HomeScreen user={user} onNavigate={onNavigate} onOpenProgress={onOpenProgress} />)

    fireEvent.click(screen.getByRole('button', { name: 'Жим лёжа: 70 → 85 кг при 6 повт. — +21% за год' }))
    expect(onOpenProgress).toHaveBeenCalledWith('bench')
    fireEvent.click(screen.getByRole('button', { name: 'Прогресс' }))
    expect(onNavigate).toHaveBeenCalledWith('progress')
    const currentWeek = screen.getByRole('button', { name: /27 июл – 2 авг: 1 тренировка/ })
    fireEvent.click(currentWeek)
    expect(screen.getByText('29 июля')).toBeInTheDocument()
    expect(screen.getByText(/середина груди/)).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Открыть всю историю' }))
    expect(onNavigate).toHaveBeenCalledWith('history')
  })

  it('в пустом состоянии даёт прямой вход в новую тренировку', () => {
    vi.mocked(useLiveQuery).mockReturnValue({
      summary: { hasData: false },
      insights: [],
      freshness: { recovery: [] },
    })
    const onNewWorkout = vi.fn()
    render(<HomeScreen user={user} onNewWorkout={onNewWorkout} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Записать тренировку' }))
    expect(onNewWorkout).toHaveBeenCalledOnce()
  })
})
