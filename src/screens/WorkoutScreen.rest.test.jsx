// @vitest-environment jsdom
// Таймер отдыха в композере (v8.8.0): пилюля только у новой тренировки за сегодня,
// старт тапом, лист с пресетами, «Пропустить», пуш ставится и снимается, сохранение
// гасит отдых, выключенный таймер не показывается.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkout, getWorkoutFeels, saveWorkout, setWorkoutFeels } from '../db/repo.js'
import { detectGoalReachedOnSave, detectNewPrsOnSave } from '../db/notifications.js'
import { detectInsightsOnSave } from '../db/insights.js'
import { detectBadgesOnSave } from '../db/badges.js'
import { scheduleRestPush, cancelRestPush } from '../db/restPush.js'
import { resetDraftMemory, writeDraft } from '../lib/draftStore.js'
import WorkoutScreen from './WorkoutScreen.jsx'

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: vi.fn((_query, _deps, fallback) => fallback),
}))
vi.mock('../db/repo.js', () => ({
  getExercises: vi.fn(), getWorkout: vi.fn(), getWorkouts: vi.fn(), saveWorkout: vi.fn(),
  createExercise: vi.fn(), deleteWorkout: vi.fn(), getRecentSessionsForExercise: vi.fn(),
  getProgSettings: vi.fn(), setProgForExercise: vi.fn(), saveTemplate: vi.fn(),
  getWorkoutFeels: vi.fn(), setWorkoutFeels: vi.fn(), getFavorites: vi.fn(), toggleFavorite: vi.fn(),
}))
vi.mock('../db/notifications.js', () => ({ detectNewPrsOnSave: vi.fn(), detectGoalReachedOnSave: vi.fn() }))
vi.mock('../db/insights.js', () => ({ detectInsightsOnSave: vi.fn() }))
vi.mock('../db/badges.js', () => ({ detectBadgesOnSave: vi.fn() }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../db/restPush.js', () => ({ scheduleRestPush: vi.fn(), cancelRestPush: vi.fn() }))

const user = { id: 'u1', name: 'Саня' }
const draft = [{
  exercise: { id: 'bench', name: 'Жим лежа', metric: 'weight', muscle_group: 'грудь', secondary: [] },
  sets: [{ weight: 60, reps: 8, _k: 'set-1' }],
}]
const pill = () => screen.queryByRole('button', { name: /Таймер отдыха|Отдых,|Отдых закончился/ })

describe('WorkoutScreen: таймер отдыха', () => {
  beforeEach(() => {
    resetDraftMemory()
    localStorage.clear()
    vi.mocked(useLiveQuery).mockImplementation((_query, _deps, fallback) => fallback)
    vi.mocked(getWorkoutFeels).mockResolvedValue({})
    vi.mocked(setWorkoutFeels).mockResolvedValue(undefined)
    vi.mocked(saveWorkout).mockResolvedValue('saved')
    vi.mocked(getWorkout).mockResolvedValue(null)
    vi.mocked(detectNewPrsOnSave).mockResolvedValue([])
    vi.mocked(detectGoalReachedOnSave).mockResolvedValue([])
    vi.mocked(detectBadgesOnSave).mockResolvedValue([])
    vi.mocked(detectInsightsOnSave).mockResolvedValue([])
    vi.mocked(scheduleRestPush).mockReset().mockResolvedValue(true)
    vi.mocked(cancelRestPush).mockReset().mockResolvedValue(true)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
  })
  afterEach(() => { vi.useRealTimers() })

  it('новая за сегодня: пилюля 1:30, тап — отдых идет и пуш ставится с текстом упражнения', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)
    const p = pill()
    expect(p).toHaveAccessibleName('Таймер отдыха, 1:30. Начать')
    // Рядом с пилюлей дата короче — «Сегодня» без числа (влезает в строку на 390 px).
    expect(document.querySelector('.date-chip__value')).toHaveTextContent(/^Сегодня$/)
    fireEvent.click(p)
    expect(pill()).toHaveAccessibleName(/^Отдых, осталось 1:30/)
    expect(scheduleRestPush).toHaveBeenCalledWith('u1', {
      inSec: 90, title: 'Отдых закончился', body: 'Жим лежа — пора к следующему подходу',
    })
    expect(JSON.parse(localStorage.getItem('gym_app_rest_run_u1'))).toMatchObject({ durMs: 90_000, exerciseId: 'bench' })
  })

  it('лист: пресет запоминается для упражнения, «Пропустить» снимает отдых и пуш', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)
    fireEvent.click(pill())
    fireEvent.click(pill()) // идет — открывает лист
    const dialog = await screen.findByRole('dialog', { name: 'Отдых' })
    fireEvent.click(screen.getByRole('button', { name: '3:00' }))
    expect(scheduleRestPush).toHaveBeenLastCalledWith('u1', expect.objectContaining({ inSec: 180 }))
    expect(JSON.parse(localStorage.getItem('gym_app_rest_u1')).byEx).toEqual({ bench: 180 })
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 15 секунд' }))
    expect(dialog).toHaveTextContent('из 3:15')
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить отдых' }))
    expect(cancelRestPush).toHaveBeenCalledWith('u1')
    expect(localStorage.getItem('gym_app_rest_run_u1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'готово' }))
    expect(pill()).toHaveAccessibleName('Таймер отдыха, 3:00. Начать')
  })

  it('конец отдыха: перебор и снятый пуш в открытом приложении', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    writeDraft(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)
    fireEvent.click(pill())
    await act(async () => { vi.advanceTimersByTime(95_000) })
    expect(pill()).toHaveAccessibleName(/^Отдых закончился 0:0[45] назад/)
    expect(cancelRestPush).toHaveBeenCalledWith('u1')
  })

  it('сохранение тренировки гасит отдых', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} onSaved={() => {}} />)
    fireEvent.click(pill())
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))
    await waitFor(() => expect(localStorage.getItem('gym_app_rest_run_u1')).toBeNull())
    expect(cancelRestPush).toHaveBeenCalled()
  })

  it('правка старой тренировки и выключенный таймер — без пилюли', async () => {
    vi.mocked(getWorkout).mockResolvedValue({
      id: 'w1', performed_at: '2026-07-30T12:00:00.000Z',
      entries: [{ exercise_id: 'bench', exercise: draft[0].exercise, sets: [{ weight: 60, reps: 8 }] }],
    })
    const r = render(<WorkoutScreen user={user} workoutId="w1" />)
    await screen.findByText('Жим лежа')
    expect(pill()).toBeNull()
    r.unmount()

    localStorage.setItem('gym_app_rest_u1', JSON.stringify({ on: false }))
    render(<WorkoutScreen user={user} />)
    expect(pill()).toBeNull()
  })
})
