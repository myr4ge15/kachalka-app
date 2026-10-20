// @vitest-environment jsdom
// Запись тренировки — ветки, которых не видели остальные тесты экрана (покрытие тестами
// 20.10.2026: WorkoutScreen 85 % строк): то же упражнение второй раз — подсказка, а не дубль;
// пакетное добавление (сканер): новые — с рекомендацией или подходом по умолчанию, уже
// стоящие — пропуск с понятным текстом; «убрать» с отменой в тосте; ошибка записи — текст,
// черновик цел.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getRecentSessionsForExercise, saveWorkout } from '../db/repo.js'
import { readDraft, resetDraftMemory, writeDraft } from '../lib/draftStore.js'
import WorkoutScreen from './WorkoutScreen.jsx'
import Toast from '../components/ui/Toast.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (_q, _d, fallback) => fallback }))
vi.mock('../db/repo.js', () => ({
  getExercises: vi.fn(), getWorkout: vi.fn(), getWorkouts: vi.fn(), saveWorkout: vi.fn(), createExercise: vi.fn(),
  deleteWorkout: vi.fn(), getRecentSessionsForExercise: vi.fn(), getProgSettings: vi.fn(), setProgForExercise: vi.fn(),
  saveTemplate: vi.fn(), getWorkoutFeels: vi.fn(async () => ({})), setWorkoutFeels: vi.fn(async () => {}),
  getFavorites: vi.fn(), toggleFavorite: vi.fn(),
}))
vi.mock('../db/notifications.js', () => ({ detectNewPrsOnSave: vi.fn(async () => []), detectGoalReachedOnSave: vi.fn(async () => []) }))
vi.mock('../db/insights.js', () => ({ detectInsightsOnSave: vi.fn(async () => []) }))
vi.mock('../db/badges.js', () => ({ detectBadgesOnSave: vi.fn(async () => []) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
// Пикер — заглушка: «выбрать одно» и «выбрать пачку» (сканер).
const picker = vi.hoisted(() => ({ props: null }))
vi.mock('../components/exercises/ExercisePicker.jsx', () => ({
  default: (props) => { picker.props = props; return <div role="dialog" aria-label="Пикер" /> },
}))

const user = { id: 'u1', name: 'Саня' }
const BENCH = { id: 'bench', name: 'Жим лежа', metric: 'weight', muscle_group: 'грудь', secondary: [] }
const PULL = { id: 'pull', name: 'Подтягивания', metric: 'reps', muscle_group: 'спина', secondary: [] }
const SQUAT = { id: 'squat', name: 'Присед', metric: 'weight', muscle_group: 'ноги', secondary: [] }
const KEY = `workout_draft_new_${user.id}`

function renderScreen() {
  return render(<><WorkoutScreen user={user} /><Toast /></>)
}
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }))

beforeEach(() => {
  resetDraftMemory()
  localStorage.clear()
  writeDraft(KEY, [{ exercise: BENCH, sets: [{ weight: 60, reps: 8, _k: 's1' }] }])
  vi.mocked(getRecentSessionsForExercise).mockResolvedValue([])
  vi.mocked(saveWorkout).mockResolvedValue('w1')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
})
afterEach(() => vi.clearAllMocks())

describe('WorkoutScreen — добавление', () => {
  it('то же упражнение второй раз — «уже добавлено», пикер закрыт, дубля нет', async () => {
    renderScreen()
    openPicker()
    await act(async () => { await picker.props.onPick(BENCH) })
    expect(screen.getByText('Это упражнение уже добавлено')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Пикер' })).toBeNull()
    expect(readDraft(KEY)).toHaveLength(1)
  })

  it('пачка: новые добавлены (сбой истории — подход по умолчанию), уже стоящие — «Уже были: 1»', async () => {
    vi.mocked(getRecentSessionsForExercise).mockImplementation(async (_u, id) => {
      if (id === 'squat') throw new Error('db')
      return []
    })
    renderScreen()
    openPicker()
    await act(async () => { await picker.props.onPickMany([BENCH, PULL, SQUAT]) })
    expect(screen.getByText('Уже были в тренировке: 1')).toBeInTheDocument()
    await waitFor(() => expect(readDraft(KEY).map((e) => e.exercise.id)).toEqual(['bench', 'pull', 'squat']))
    expect(readDraft(KEY)[2].sets).toHaveLength(1)
  })

  it('пачка из уже стоящих — «Эти упражнения уже добавлены»', async () => {
    renderScreen()
    openPicker()
    await act(async () => { await picker.props.onPickMany([BENCH]) })
    expect(screen.getByText('Эти упражнения уже добавлены')).toBeInTheDocument()
  })
})

describe('WorkoutScreen — убрать и сохранить', () => {
  it('«убрать» — сразу, но с «Отменить» в тосте: упражнение возвращается на место', async () => {
    writeDraft(KEY, [{ exercise: BENCH, sets: [{ weight: 60, reps: 8, _k: 's1' }] }, { exercise: PULL, sets: [{ weight: 0, reps: 10, _k: 's2' }] }])
    renderScreen()
    fireEvent.click(screen.getAllByRole('button', { name: 'убрать' })[0])
    await waitFor(() => expect(readDraft(KEY).map((e) => e.exercise.id)).toEqual(['pull']))
    expect(screen.getByText('Упражнение убрано')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    await waitFor(() => expect(readDraft(KEY).map((e) => e.exercise.id)).toEqual(['bench', 'pull']))
  })

  it('запись не удалась — «Не сохранилось: …», черновик на месте, можно повторить', async () => {
    vi.mocked(saveWorkout).mockRejectedValueOnce(new Error('QuotaExceededError'))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /^Сохранить/ }))
    expect(await screen.findByText('Не сохранилось: QuotaExceededError')).toBeInTheDocument()
    expect(readDraft(KEY)).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Сохранить/ })).toBeEnabled()
  })
})
