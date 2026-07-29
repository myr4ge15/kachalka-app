// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
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

describe('WorkoutScreen', () => {
  beforeEach(() => {
    clearCache()
    vi.mocked(useLiveQuery).mockImplementation((_query, _deps, fallback) => fallback)
  })

  it('восстанавливает черновик новой тренировки из сессионного кэша', () => {
    setCache(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)

    expect(screen.getByText('Жим лёжа')).toBeInTheDocument()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()
    expect(screen.getByDisplayValue('8')).toBeInTheDocument()
  })

  it('открывает пикер как диалог и закрывает его по Escape', () => {
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))

    const dialog = screen.getByRole('dialog', { name: 'Упражнение' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Упражнение' })).not.toBeInTheDocument()
  })
})
