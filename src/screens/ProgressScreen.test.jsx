// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import ProgressScreen from './ProgressScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/repo.js', () => ({ getWorkouts: vi.fn() }))
vi.mock('../db/notifications.js', () => ({ readGoals: vi.fn() }))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  LineChart: ({ children }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Dot: () => null,
  ReferenceArea: () => null,
  ReferenceLine: () => null,
}))

const workout = {
  id: 'w1',
  user_id: 'u1',
  performed_at: '2026-07-20T12:00:00Z',
  entries: [{
    exercise_id: 'bench',
    exercise: {
      id: 'bench',
      name: 'Жим лёжа',
      metric: 'weight',
      is_bench_lift: true,
    },
    sets: [{ weight: 90, reps: 5 }],
  }],
}

describe('ProgressScreen — ориентир цели', () => {
  beforeEach(() => vi.mocked(useLiveQuery).mockReset())

  it('показывает разрыв до активной цели и открывает её', () => {
    vi.mocked(useLiveQuery)
      .mockReturnValueOnce([workout])
      .mockReturnValueOnce([{
        exerciseId: 'bench',
        exerciseName: 'Жим лёжа',
        metric: 'weight',
        targetWeight: 100,
      }])
    const onOpenGoals = vi.fn()

    render(<ProgressScreen user={{ id: 'u1' }} onOpenGoals={onOpenGoals} />)

    expect(screen.getByText('Цель · 100 кг')).toBeInTheDocument()
    expect(screen.getByText('осталось 10 кг')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть цель Жим лёжа' }))
    expect(onOpenGoals).toHaveBeenCalledOnce()
  })
})

