// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import HistoryScreen from './HistoryScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/repo.js', () => ({ getWorkouts: vi.fn() }))
vi.mock('./WorkoutScreen.jsx', () => ({
  default: ({ workoutId }) => <div data-testid="workout-screen">{workoutId ?? 'new'}</div>,
}))
vi.mock('./TemplatesScreen.jsx', () => ({
  default: () => <div data-testid="templates-screen">templates</div>,
}))
vi.mock('../lib/exportWorkout.js', () => ({ exportWorkouts: vi.fn() }))

const user = { id: 'u1', name: 'Саня' }
const workout = {
  id: 'w1',
  user_id: 'u1',
  performed_at: '2026-07-29T10:00:00Z',
  entries: [{
    exercise_id: 'bench',
    exercise: { id: 'bench', name: 'Жим лёжа', metric: 'weight', muscle_group: 'грудь' },
    sets: [{ weight: 80, reps: 6 }],
  }],
}

describe('HistoryScreen', () => {
  beforeEach(() => {
    vi.mocked(useLiveQuery).mockReset()
    vi.mocked(useLiveQuery).mockReturnValue([workout])
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  it('на мобильном открывает выбранную тренировку вместо списка', () => {
    render(<HistoryScreen user={user} />)
    fireEvent.click(screen.getByText('Жим лёжа').closest('button'))
    expect(screen.getByTestId('workout-screen')).toHaveTextContent('w1')
    expect(screen.queryByText('Мои тренировки')).not.toBeInTheDocument()
  })

  it('принимает внешний интент новой тренировки и сообщает busy', async () => {
    const onConsumed = vi.fn()
    const onBusy = vi.fn()
    render(
      <HistoryScreen
        user={user}
        openNew
        onOpenNewConsumed={onConsumed}
        onBusyChange={onBusy}
      />
    )

    expect(screen.getByTestId('workout-screen')).toHaveTextContent('new')
    await waitFor(() => expect(onConsumed).toHaveBeenCalledOnce())
    expect(onBusy).toHaveBeenCalledWith(true)
  })
})
