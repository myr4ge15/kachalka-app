// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getRecentSessionsForExercise, getWorkout, saveWorkout } from '../db/repo.js'
import { clearCache, setCache } from '../lib/cache.js'
import WorkoutScreen from './WorkoutScreen.jsx'

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: vi.fn((_query, _deps, fallback) => fallback),
}))
vi.mock('../db/repo.js', () => ({
  getExercises: vi.fn(),
  getWorkout: vi.fn(),
  getWorkouts: vi.fn(),
  saveWorkout: vi.fn(),
  createExercise: vi.fn(),
  deleteWorkout: vi.fn(),
  getRecentSessionsForExercise: vi.fn(),
  getProgSettings: vi.fn(),
  setProgForExercise: vi.fn(),
  saveTemplate: vi.fn(),
}))
vi.mock('../db/notifications.js', () => ({
  detectNewPrsOnSave: vi.fn(),
  detectGoalReachedOnSave: vi.fn(),
}))
vi.mock('../db/insights.js', () => ({ detectInsightsOnSave: vi.fn() }))
vi.mock('../db/badges.js', () => ({ detectBadgesOnSave: vi.fn() }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))

const user = { id: 'u1', name: 'Саня' }
const scrollIntoView = vi.fn()
const draft = [{
  exercise: {
    id: 'bench',
    name: 'Жим лёжа',
    metric: 'weight',
    muscle_group: 'грудь',
    secondary: [],
  },
  sets: [{ weight: 60, reps: 8, _k: 'set-1' }],
}]
const secondEntry = {
  exercise: {
    id: 'pullup',
    name: 'Подтягивания',
    metric: 'reps',
    muscle_group: 'спина',
    secondary: [],
  },
  sets: [{ weight: 0, reps: 12, _k: 'set-2' }],
}

describe('WorkoutScreen', () => {
  beforeEach(() => {
    clearCache()
    vi.mocked(getWorkout).mockReset()
    vi.mocked(getRecentSessionsForExercise).mockReset()
    vi.mocked(saveWorkout).mockReset()
    vi.mocked(saveWorkout).mockResolvedValue('saved-workout')
    vi.mocked(useLiveQuery).mockImplementation((_query, _deps, fallback) => fallback)
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

  it('восстанавливает черновик новой тренировки из сессионного кэша', () => {
    setCache(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)

    expect(screen.getByText('Жим лёжа')).toBeInTheDocument()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()
    expect(screen.getByDisplayValue('8')).toBeInTheDocument()
  })

  it('держит активность по exercise.id и раскрывает компактную карточку одним тапом', () => {
    setCache(`workout_draft_new_${user.id}`, [...draft, secondEntry])
    const { container } = render(<WorkoutScreen user={user} />)
    const bench = container.querySelector('[data-exercise-id="bench"]')
    const pullup = container.querySelector('[data-exercise-id="pullup"]')

    expect(bench).toHaveAttribute('data-active', 'true')
    expect(pullup).toHaveAttribute('data-active', 'false')
    expect(screen.queryByDisplayValue('12')).not.toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Открыть Подтягивания/ }))

    expect(bench).toHaveAttribute('data-active', 'false')
    expect(pullup).toHaveAttribute('data-active', 'true')
    expect(screen.getByDisplayValue('12')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  })

  it('центрирует без анимации при prefers-reduced-motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    })
    setCache(`workout_draft_new_${user.id}`, [...draft, secondEntry])
    render(<WorkoutScreen user={user} />)

    fireEvent.click(screen.getByRole('button', { name: /Открыть Подтягивания/ }))

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest',
    })
  })

  it('при редактировании начинает с первого незаполненного упражнения', async () => {
    vi.mocked(getWorkout).mockResolvedValue({
      id: 'w1',
      performed_at: '2026-07-30T12:00:00.000Z',
      entries: [
        { exercise_id: 'bench', exercise: draft[0].exercise, sets: [{ weight: 60, reps: 8 }] },
        {
          exercise_id: 'squat',
          exercise: { id: 'squat', name: 'Присед', metric: 'weight' },
          sets: [{ weight: 0, reps: 0 }],
        },
      ],
    })
    const { container } = render(<WorkoutScreen user={user} workoutId="w1" />)

    await screen.findByText('Присед')
    expect(container.querySelector('[data-exercise-id="bench"]')).toHaveAttribute('data-active', 'false')
    expect(container.querySelector('[data-exercise-id="squat"]')).toHaveAttribute('data-active', 'true')
  })

  it('открывает пикер как диалог и закрывает его по Escape', () => {
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))

    const dialog = screen.getByRole('dialog', { name: 'Упражнение' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Упражнение' })).not.toBeInTheDocument()
  })

  it('закрывает пикер одновременно с появлением добавленного упражнения', async () => {
    let finishHistory
    vi.mocked(getRecentSessionsForExercise).mockReturnValue(
      new Promise((resolve) => { finishHistory = resolve })
    )
    vi.mocked(useLiveQuery).mockImplementation((_query, _deps, fallback) => (
      Array.isArray(fallback) ? [draft[0].exercise] : fallback
    ))

    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: /Жим лёжа/ }))

    // Пока строится локальная рекомендация, лист не исчезает и пустой экран
    // с одинокой кнопкой «Сохранить» не успевает попасть в отрисовку.
    expect(screen.getByRole('dialog', { name: 'Упражнение' })).toBeInTheDocument()

    await act(async () => { finishHistory([]) })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Упражнение' })).not.toBeInTheDocument()
    })
    expect(screen.getByText('Жим лёжа')).toBeInTheDocument()
    expect(screen.getByText('Жим лёжа').closest('[data-exercise-id]')).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'Сохранить (1)' })).toBeInTheDocument()
  })

  it('сохраняет весь состав, включая компактные неактивные карточки', async () => {
    setCache(`workout_draft_new_${user.id}`, [...draft, secondEntry])
    const onBack = vi.fn()
    render(<WorkoutScreen user={user} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (2)' }))

    await waitFor(() => expect(saveWorkout).toHaveBeenCalledOnce())
    expect(vi.mocked(saveWorkout).mock.calls[0][0].entries).toHaveLength(2)
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce())
  })
})
