// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import HomeScreen from './HomeScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/insights.js', () => ({ getHomeData: vi.fn() }))

const user = { id: 'u1', name: 'Саня' }
const readyHome = {
  summary: {
    hasData: true,
    tonnage: { month: 1000, pct: 10 },
    lastWorkout: { daysAgo: 1, tags: [] },
    streak: 2,
    workoutsThisMonth: 3,
    latestPr: null,
    nearestGoal: null,
    rhythm: Array.from({ length: 56 }, (_, i) => ({
      day: `2026-07-${String(i + 1).padStart(2, '0')}`,
      count: i === 55 ? 1 : 0,
      tags: [],
      today: i === 55,
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
  beforeEach(() => vi.mocked(useLiveQuery).mockReset())

  it('показывает инсайт «себя прошлого» и ведёт в Прогресс', () => {
    vi.mocked(useLiveQuery).mockReturnValue(readyHome)
    const onNavigate = vi.fn()
    const onOpenProgress = vi.fn()
    render(<HomeScreen user={user} onNavigate={onNavigate} onOpenProgress={onOpenProgress} />)

    fireEvent.click(screen.getByRole('button', { name: 'Жим лёжа: 70 → 85 кг при 6 повт. — +21% за год' }))
    expect(onOpenProgress).toHaveBeenCalledWith('bench')
    fireEvent.click(screen.getByRole('button', { name: 'Прогресс' }))
    expect(onNavigate).toHaveBeenCalledWith('progress')
    fireEvent.click(screen.getByRole('button', { name: 'Открыть историю тренировок за 8 недель' }))
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
