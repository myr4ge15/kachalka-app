// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getRecentSessionsForExercise, getWorkout, getWorkoutFeels, saveWorkout, setWorkoutFeels } from '../db/repo.js'
import { detectGoalReachedOnSave, detectNewPrsOnSave } from '../db/notifications.js'
import { detectInsightsOnSave } from '../db/insights.js'
import { detectBadgesOnSave } from '../db/badges.js'
import { readDraft, resetDraftMemory, writeDraft } from '../lib/draftStore.js'
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
  getWorkoutFeels: vi.fn(),
  setWorkoutFeels: vi.fn(),
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
    name: 'Жим лежа',
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
    resetDraftMemory()
    localStorage.clear()
    vi.mocked(getWorkout).mockReset()
    vi.mocked(getRecentSessionsForExercise).mockReset()
    vi.mocked(saveWorkout).mockReset()
    vi.mocked(saveWorkout).mockResolvedValue('saved-workout')
    vi.mocked(getWorkoutFeels).mockReset()
    vi.mocked(getWorkoutFeels).mockResolvedValue({})
    vi.mocked(setWorkoutFeels).mockReset()
    vi.mocked(setWorkoutFeels).mockResolvedValue(undefined)
    vi.mocked(detectNewPrsOnSave).mockReset()
    vi.mocked(detectNewPrsOnSave).mockResolvedValue([])
    vi.mocked(detectGoalReachedOnSave).mockReset()
    vi.mocked(detectGoalReachedOnSave).mockResolvedValue([])
    vi.mocked(detectBadgesOnSave).mockReset()
    vi.mocked(detectBadgesOnSave).mockResolvedValue([])
    vi.mocked(detectInsightsOnSave).mockReset()
    vi.mocked(detectInsightsOnSave).mockResolvedValue([])
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

  it('черновик переживает перезапуск страницы (выгрузку PWA в фоне)', () => {
    const first = render(<WorkoutScreen user={user} />)
    first.unmount()
    writeDraft(`workout_draft_new_${user.id}`, draft)
    // «Перезапуск»: память модуля пуста, остается только диск.
    resetDraftMemory()
    expect(readDraft(`workout_draft_new_${user.id}`)).toEqual(draft)

    render(<WorkoutScreen user={user} />)
    expect(screen.getByText('Жим лежа')).toBeInTheDocument()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()
  })

  it('восстанавливает черновик новой тренировки из хранилища черновика', () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)

    expect(screen.getByText('Жим лежа')).toBeInTheDocument()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()
    expect(screen.getByDisplayValue('8')).toBeInTheDocument()
  })

  it('держит активность по exercise.id и раскрывает компактную карточку одним тапом', () => {
    writeDraft(`workout_draft_new_${user.id}`, [...draft, secondEntry])
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

  it('после «убрать» раскрывает соседнюю карточку, а не первую', () => {
    const third = {
      exercise: { id: 'squat', name: 'Присед', metric: 'weight', muscle_group: 'ноги', secondary: [] },
      sets: [{ weight: 100, reps: 5, _k: 'set-3' }],
    }
    writeDraft(`workout_draft_new_${user.id}`, [...draft, secondEntry, third])
    const { container } = render(<WorkoutScreen user={user} />)
    const card = (id) => container.querySelector(`[data-exercise-id="${id}"]`)

    fireEvent.click(screen.getByRole('button', { name: /Открыть Подтягивания/ }))
    fireEvent.click(screen.getByRole('button', { name: 'убрать' }))
    expect(card('pullup')).toBeNull()
    expect(card('squat')).toHaveAttribute('data-active', 'true')
    expect(card('bench')).toHaveAttribute('data-active', 'false')

    // Последняя карточка — фокус уходит на предыдущую.
    fireEvent.click(screen.getByRole('button', { name: 'убрать' }))
    expect(card('squat')).toBeNull()
    expect(card('bench')).toHaveAttribute('data-active', 'true')
  })

  it('центрирует без анимации при prefers-reduced-motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    })
    writeDraft(`workout_draft_new_${user.id}`, [...draft, secondEntry])
    render(<WorkoutScreen user={user} />)

    fireEvent.click(screen.getByRole('button', { name: /Открыть Подтягивания/ }))

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest',
    })
  })

  it('свернутая карточка показывает сводку подходов, отметок выполнения нет', () => {
    writeDraft(`workout_draft_new_${user.id}`, [...draft, secondEntry])
    render(<WorkoutScreen user={user} />)

    expect(screen.queryByRole('button', { name: /Отметить подход|выполнен/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Открыть Подтягивания/ }))
    expect(screen.getByText('1 подход · 60×8')).toBeInTheDocument()
  })

  it('чистит ключ отметок черновика из версий до 6.1.0', () => {
    writeDraft(`workout_done_new_${user.id}`, ['bench::set-1'])
    render(<WorkoutScreen user={user} />)
    expect(readDraft(`workout_done_new_${user.id}`) ?? null).toBeNull()
  })

  it('оценка «как пошло» пишется ПОСЛЕ сохранения — с id, которого до него нет', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)

    fireEvent.click(screen.getByRole('button', { name: 'тяжело' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))

    await waitFor(() => expect(setWorkoutFeels).toHaveBeenCalledOnce())
    const [uid, wId, , feels] = vi.mocked(setWorkoutFeels).mock.calls[0]
    expect(uid).toBe('u1')
    expect(wId).toBe('saved-workout') // id выдал saveWorkout, до него оценку писать некуда
    expect(feels).toEqual({ bench: 'hard' })
    // в сам документ тренировки оценка не попадает
    expect(vi.mocked(saveWorkout).mock.calls[0][0].entries[0]).not.toHaveProperty('feel')
  })

  it('повторный тап снимает оценку — промах не фиксируется навсегда', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    render(<WorkoutScreen user={user} />)

    fireEvent.click(screen.getByRole('button', { name: 'легко' }))
    expect(screen.getByRole('button', { name: 'легко' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'легко' }))
    expect(screen.getByRole('button', { name: 'легко' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))
    await waitFor(() => expect(setWorkoutFeels).toHaveBeenCalledOnce())
    expect(vi.mocked(setWorkoutFeels).mock.calls[0][3]).toEqual({})
  })

  it('сохранение не ломается, если запись оценок упала', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    vi.mocked(setWorkoutFeels).mockRejectedValue(new Error('meta недоступна'))
    const onSaved = vi.fn()
    render(<WorkoutScreen user={user} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'нормально' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(screen.queryByText(/Не сохранилось/)).not.toBeInTheDocument()
  })

  it('правка открывается с прежней оценкой', async () => {
    vi.mocked(getWorkout).mockResolvedValue({
      id: 'w1',
      performed_at: '2026-07-30T12:00:00.000Z',
      entries: [{ exercise_id: 'bench', exercise: draft[0].exercise, sets: [{ weight: 60, reps: 8 }] }],
    })
    vi.mocked(getWorkoutFeels).mockResolvedValue({ bench: 'easy' })
    render(<WorkoutScreen user={user} workoutId="w1" />)

    await screen.findByText('Жим лежа')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'легко' })).toHaveAttribute('aria-pressed', 'true')
    )
  })

  it('в правке подход, удаленный ✕, не сохраняется', async () => {
    vi.mocked(getWorkout).mockResolvedValue({
      id: 'w1',
      performed_at: '2026-07-30T12:00:00.000Z',
      entries: [{
        exercise_id: 'bench',
        exercise: draft[0].exercise,
        sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 6 }],
      }],
    })
    render(<WorkoutScreen user={user} workoutId="w1" />)

    await screen.findByText('Жим лежа')
    expect(screen.getByRole('button', { name: 'Сохранить (2)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))

    await waitFor(() => expect(saveWorkout).toHaveBeenCalledOnce())
    expect(vi.mocked(saveWorkout).mock.calls[0][0].entries[0].sets)
      .toEqual([{ weight: 60, reps: 8, _k: expect.anything() }])
  })

  it('в правке добавленный подход сохраняется', async () => {
    vi.mocked(getWorkout).mockResolvedValue({
      id: 'w1',
      performed_at: '2026-07-30T12:00:00.000Z',
      entries: [{ exercise_id: 'bench', exercise: draft[0].exercise, sets: [{ weight: 60, reps: 8 }] }],
    })
    render(<WorkoutScreen user={user} workoutId="w1" />)

    await screen.findByText('Жим лежа')
    fireEvent.click(screen.getByRole('button', { name: '+ подход (повтор предыдущего)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (2)' }))

    await waitFor(() => expect(saveWorkout).toHaveBeenCalledOnce())
    expect(vi.mocked(saveWorkout).mock.calls[0][0].entries[0].sets).toHaveLength(2)
  })

  it('после правки не показывает итоговый экран, а возвращает в список', async () => {
    vi.mocked(getWorkout).mockResolvedValue({
      id: 'w1',
      performed_at: '2026-07-30T12:00:00.000Z',
      entries: [{ exercise_id: 'bench', exercise: draft[0].exercise, sets: [{ weight: 60, reps: 8 }] }],
    })
    const onSaved = vi.fn()
    const onBack = vi.fn()
    render(<WorkoutScreen user={user} workoutId="w1" onSaved={onSaved} onBack={onBack} />)

    await screen.findByText('Жим лежа')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))

    await waitFor(() => expect(onBack).toHaveBeenCalledOnce())
    expect(onSaved).not.toHaveBeenCalled()
    // Рекорды/цели для правки не считаем — итога у нее нет по построению.
    expect(detectNewPrsOnSave).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: /Жим лежа/ }))

    // Пока строится локальная рекомендация, лист не исчезает и пустой экран
    // с одинокой кнопкой «Сохранить» не успевает попасть в отрисовку.
    expect(screen.getByRole('dialog', { name: 'Упражнение' })).toBeInTheDocument()

    await act(async () => { finishHistory([]) })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Упражнение' })).not.toBeInTheDocument()
    })
    expect(screen.getByText('Жим лежа')).toBeInTheDocument()
    expect(screen.getByText('Жим лежа').closest('[data-exercise-id]')).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'Сохранить (1)' })).toBeInTheDocument()
  })

  it('сохраняет весь состав, включая компактные неактивные карточки', async () => {
    writeDraft(`workout_draft_new_${user.id}`, [...draft, secondEntry])
    const onBack = vi.fn()
    render(<WorkoutScreen user={user} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (2)' }))

    await waitFor(() => expect(saveWorkout).toHaveBeenCalledOnce())
    expect(vi.mocked(saveWorkout).mock.calls[0][0].entries).toHaveLength(2)
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce())
  })

  it('после локальной записи отдает сохраненную тренировку итоговому экрану', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    vi.mocked(getWorkout).mockResolvedValue({
      id: 'saved-workout',
      user_id: user.id,
      entries: [{ exercise_id: 'bench', exercise: draft[0].exercise, sets: [{ weight: 60, reps: 8 }] }],
    })
    const onSaved = vi.fn()
    const onBack = vi.fn()
    render(<WorkoutScreen user={user} onSaved={onSaved} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      workout: expect.objectContaining({ id: 'saved-workout' }),
      events: [],
    }))
    expect(onBack).not.toHaveBeenCalled()
  })

  it('передает рекорд итоговому экрану вместо отдельного поздравительного тоста', async () => {
    writeDraft(`workout_draft_new_${user.id}`, draft)
    vi.mocked(detectNewPrsOnSave).mockResolvedValue([{
      exerciseId: 'bench',
      name: 'Жим лежа',
      metric: 'weight',
      value: 100,
      prev: 95,
    }])
    const onSaved = vi.fn()
    render(<WorkoutScreen user={user} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({
        kind: 'pr',
        exerciseId: 'bench',
        title: 'Новый рекорд!',
      })],
    })))
  })
})
