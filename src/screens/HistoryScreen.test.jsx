// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { saveTemplate } from '../db/repo.js'
import HistoryScreen from './HistoryScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/repo.js', () => ({ getWorkouts: vi.fn(), saveTemplate: vi.fn() }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('./WorkoutScreen.jsx', () => ({
  default: ({ workoutId, onSaved }) => (
    <div data-testid="workout-screen">
      {workoutId ?? 'new'}
      <button onClick={() => onSaved?.({ workout, events: [] })}>Сохранить тестовую</button>
      <button onClick={() => onSaved?.({
        workout,
        events: [{
          kind: 'pr',
          emoji: '🏆',
          title: 'Новый рекорд!',
          text: 'Жим лёжа — 80 кг (было 75 кг)',
          exerciseId: 'bench',
        }],
      })}>
        Сохранить с рекордом
      </button>
    </div>
  ),
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
    vi.mocked(saveTemplate).mockReset()
    vi.mocked(saveTemplate).mockResolvedValue('tpl-1')
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

  it('после локального сохранения возвращает историю и открывает итог', async () => {
    const onBusy = vi.fn()
    render(<HistoryScreen user={user} openNew onBusyChange={onBusy} />)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить тестовую' }))

    expect(screen.queryByTestId('workout-screen')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Тренировка готова' })).toBeInTheDocument()
    expect(screen.getByText('Упражнения').nextElementSibling).toHaveTextContent('1')
    expect(onBusy).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.queryByRole('dialog', { name: 'Тренировка готова' })).not.toBeInTheDocument()
    expect(screen.getByText('Мои тренировки')).toBeInTheDocument()
    await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false))
  })

  it('из главного события открывает Прогресс нужного упражнения', () => {
    const onOpenProgress = vi.fn()
    render(<HistoryScreen user={user} openNew onOpenProgress={onOpenProgress} />)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить с рекордом' }))
    expect(screen.getByText('Новый рекорд!')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть прогресс' }))
    expect(onOpenProgress).toHaveBeenCalledWith('bench')
    expect(screen.queryByRole('dialog', { name: 'Тренировка готова' })).not.toBeInTheDocument()
  })

  it('создаёт приватный шаблон из сохранённой тренировки прямо в итоге', async () => {
    render(<HistoryScreen user={user} openNew />)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить тестовую' }))

    fireEvent.click(screen.getByRole('button', { name: '📋 Сохранить как шаблон' }))

    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith({
      user_id: user.id,
      name: 'Тренировка 29.07',
      exercises: [{
        exercise: workout.entries[0].exercise,
        sets: 1,
        reps: 6,
        weight: 80,
      }],
      is_public: false,
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Шаблон «Тренировка 29.07» создан')
  })
})
