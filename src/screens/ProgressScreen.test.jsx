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
  // <svg>, а не <div>: внутри графика рендерятся <defs>/<linearGradient> — вне svg jsdom
  // сыпал предупреждениями «unrecognized tag» в stderr.
  LineChart: ({ children }) => <svg>{children}</svg>,
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
      name: 'Жим лежа',
      metric: 'weight',
      is_bench_lift: true,
    },
    sets: [{ weight: 90, reps: 5 }],
  }],
}

describe('ProgressScreen — ориентир цели', () => {
  beforeEach(() => vi.mocked(useLiveQuery).mockReset())

  it('показывает разрыв до активной цели и открывает ее', () => {
    vi.mocked(useLiveQuery)
      .mockReturnValueOnce([workout])
      .mockReturnValueOnce([{
        exerciseId: 'bench',
        exerciseName: 'Жим лежа',
        metric: 'weight',
        targetWeight: 100,
      }])
    const onOpenGoals = vi.fn()

    render(<ProgressScreen user={{ id: 'u1' }} onOpenGoals={onOpenGoals} />)

    expect(screen.getByText('Цель · 100 кг')).toBeInTheDocument()
    expect(screen.getByText('осталось: 10 кг')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть цель Жим лежа' }))
    expect(onOpenGoals).toHaveBeenCalledOnce()
    // Формула Эпли — по нажатию на «1ПМ (расчетный)» под заголовком, а не внизу.
    expect(screen.queryByText(/формуле Эпли/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1ПМ \(расчетный\)/ }))
    expect(screen.getByText(/формуле Эпли/)).toBeInTheDocument()
  })
})

describe('ProgressScreen — рекорд и форма (v6.5.1)', () => {
  beforeEach(() => vi.mocked(useLiveQuery).mockReset())
  const at = (daysAgo, weight) => ({
    ...workout,
    id: `w${daysAgo}`,
    performed_at: new Date(Date.now() - daysAgo * 864e5).toISOString(),
    entries: [{ ...workout.entries[0], sets: [{ weight, reps: 5 }] }],
  })

  it('рекорд поставлен недавно — одна плитка вместо двух с одним числом', () => {
    vi.mocked(useLiveQuery).mockReturnValueOnce([at(3, 95), at(100, 90)]).mockReturnValueOnce([])
    render(<ProgressScreen user={{ id: 'u1' }} />)
    expect(screen.getByText('Рекорд — и это твоя форма сейчас')).toBeInTheDocument()
    expect(screen.queryByText('Форма сейчас')).toBeNull()
  })

  it('форма ниже рекорда — две плитки, как раньше', () => {
    vi.mocked(useLiveQuery).mockReturnValueOnce([at(3, 85), at(100, 95)]).mockReturnValueOnce([])
    render(<ProgressScreen user={{ id: 'u1' }} />)
    expect(screen.getByText('Форма сейчас')).toBeInTheDocument()
    expect(screen.getByText('Рекорд')).toBeInTheDocument()
  })

  it('без тренировок — подсказка, что здесь появится', () => {
    vi.mocked(useLiveQuery).mockReturnValueOnce([]).mockReturnValueOnce([])
    render(<ProgressScreen user={{ id: 'u1' }} />)
    expect(screen.getByText('Здесь будет твой прогресс')).toBeInTheDocument()
    expect(screen.getByText(/личные рекорды/)).toBeInTheDocument()
  })
})
