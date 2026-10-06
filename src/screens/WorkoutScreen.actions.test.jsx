// @vitest-environment jsdom
// WorkoutScreen — действия композера, которые до v6.14.2 не были покрыты (замер
// покрытия 06.10: 57%): замена упражнения, применение шаблона, панель
// автопрогрессии (откат/применение/настройки), степперы подходов, очистка
// черновика, экспорт, «шаблон из тренировки» и удаление. Пикеры заменены
// заглушками: их собственное поведение покрыто своими тестами, здесь важна
// только оркестрация экрана.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  deleteWorkout, getRecentSessionsForExercise, getWorkout, getWorkoutFeels, saveTemplate, saveWorkout,
  setProgForExercise,
} from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import { exportWorkouts } from '../lib/exportWorkout.js'
import { readDraft, resetDraftMemory, writeDraft } from '../lib/draftStore.js'
import WorkoutScreen from './WorkoutScreen.jsx'
import Toast from '../components/Toast.jsx'

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
  getFavorites: vi.fn(),
  toggleFavorite: vi.fn(),
}))
vi.mock('../db/notifications.js', () => ({
  detectNewPrsOnSave: vi.fn(async () => []),
  detectGoalReachedOnSave: vi.fn(async () => []),
}))
vi.mock('../db/insights.js', () => ({ detectInsightsOnSave: vi.fn(async () => []) }))
vi.mock('../db/badges.js', () => ({ detectBadgesOnSave: vi.fn(async () => []) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../lib/exportWorkout.js', () => ({ exportWorkouts: vi.fn() }))

// Пикеры — заглушки: «выбрать» отдает заранее заданный объект.
let pickExercise = null
let pickTemplate = null
vi.mock('../components/ExercisePicker.jsx', () => ({
  default: ({ title, onPick, onClose }) => (
    <div role="dialog" aria-label={title}>
      <button onClick={() => onPick(pickExercise)}>выбрать упражнение</button>
      <button onClick={onClose}>закрыть пикер</button>
    </div>
  ),
}))
vi.mock('../components/TemplatePicker.jsx', () => ({
  default: ({ onPick }) => (
    <div role="dialog" aria-label="Шаблоны">
      <button onClick={() => onPick(pickTemplate)}>выбрать шаблон</button>
    </div>
  ),
}))

const user = { id: 'u1', name: 'Саня' }
const bench = { id: 'bench', name: 'Жим лежа', metric: 'weight', muscle_group: 'грудь', secondary: [] }
const squat = { id: 'squat', name: 'Присед', metric: 'weight', muscle_group: 'ноги', secondary: [] }
const pullup = { id: 'pullup', name: 'Подтягивания', metric: 'reps', muscle_group: 'спина', secondary: [] }
const DRAFT = `workout_draft_new_${user.id}`
const FEEL = `workout_feel_new_${user.id}`
const entry = (exercise, sets) => ({ exercise, sets: sets.map((s, i) => ({ ...s, _k: `${exercise.id}-${i}` })) })
// Прошлая сессия жима: три рабочих подхода, все «легко» → рекомендация вверх.
const history = [
  { performed_at: '2026-10-01T10:00:00Z', metric: 'weight', feel: 'easy', sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }] },
  { performed_at: '2026-09-28T10:00:00Z', metric: 'weight', feel: 'easy', sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }] },
]
const weights = () => screen.queryAllByLabelText(/^Вес, подход/).map((i) => i.value)

let prog
beforeEach(() => {
  resetDraftMemory()
  localStorage.clear()
  vi.clearAllMocks()
  pickExercise = null
  pickTemplate = null
  prog = { enabled: true, byExercise: {} }
  vi.mocked(useLiveQuery).mockImplementation((_q, deps, fallback) =>
    (fallback && typeof fallback === 'object' && 'byExercise' in fallback ? prog : fallback))
  vi.mocked(getRecentSessionsForExercise).mockResolvedValue([])
  vi.mocked(getWorkoutFeels).mockResolvedValue({})
  vi.mocked(saveWorkout).mockResolvedValue('w-saved')
  vi.mocked(setProgForExercise).mockResolvedValue(undefined)
  vi.mocked(saveTemplate).mockResolvedValue('t1')
  vi.mocked(deleteWorkout).mockResolvedValue(undefined)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

describe('замена упражнения', () => {
  it('подходы остаются, оценка переезжает на новое упражнение, пикер с заголовком «Заменить»', async () => {
    writeDraft(DRAFT, [entry(bench, [{ weight: 60, reps: 8 }])])
    writeDraft(FEEL, { bench: 'hard' })
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'заменить' }))
    expect(screen.getByRole('dialog', { name: 'Заменить упражнение' })).toBeInTheDocument()
    pickExercise = squat
    fireEvent.click(screen.getByRole('button', { name: 'выбрать упражнение' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Присед')).toBeInTheDocument()
    expect(screen.queryByText('Жим лежа')).not.toBeInTheDocument()
    expect(weights()).toEqual(['60'])
    expect(screen.getByRole('button', { name: 'тяжело' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(readDraft(FEEL)).toEqual({ squat: 'hard' }))
  })

  it('на не-весовое — вес обнуляется; на уже добавленное — ошибка, состав прежний', () => {
    writeDraft(DRAFT, [entry(bench, [{ weight: 60, reps: 8 }]), entry(squat, [{ weight: 100, reps: 5 }])])
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'заменить' })[0])
    pickExercise = squat
    fireEvent.click(screen.getByRole('button', { name: 'выбрать упражнение' }))
    expect(screen.getByText('Это упражнение уже добавлено')).toBeInTheDocument()
    expect(screen.getByText('Жим лежа')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'заменить' })[0])
    pickExercise = pullup
    fireEvent.click(screen.getByRole('button', { name: 'выбрать упражнение' }))
    expect(screen.queryByText('Это упражнение уже добавлено')).not.toBeInTheDocument()
    const saved = readDraft(DRAFT)
    expect(saved[0].exercise.id).toBe('pullup')
    expect(saved[0].sets).toEqual([expect.objectContaining({ weight: 0, reps: 8 })])
  })

  it('замена на то же самое — ничего не меняет; закрытие пикера сбрасывает режим замены', () => {
    writeDraft(DRAFT, [entry(bench, [{ weight: 60, reps: 8 }])])
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'заменить' }))
    pickExercise = bench
    fireEvent.click(screen.getByRole('button', { name: 'выбрать упражнение' }))
    expect(weights()).toEqual(['60'])

    fireEvent.click(screen.getByRole('button', { name: 'заменить' }))
    fireEvent.click(screen.getByRole('button', { name: 'закрыть пикер' }))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    expect(screen.getByRole('dialog', { name: 'Упражнение' })).toBeInTheDocument()
  })
})

describe('шаблон', () => {
  it('добавляет упражнения шаблона с его планом; рекомендация — справочно, не применена', async () => {
    vi.mocked(getRecentSessionsForExercise).mockImplementation(async (_u, id) => (id === 'bench' ? history : []))
    pickTemplate = {
      exercises: [
        { exercise: bench, sets: 2, reps: 5, weight: 70 },
        { exercise_id: 'ghost' }, // упражнение не в кэше — карточка-заглушка, но добавляется
        { exercise: null },       // без id — отсеивается
      ],
    }
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать шаблон' }))
    fireEvent.click(screen.getByRole('button', { name: 'выбрать шаблон' }))

    await screen.findByText('Жим лежа')
    expect(screen.queryByRole('dialog', { name: 'Шаблоны' })).not.toBeInTheDocument()
    expect(weights()).toEqual(['70', '70'])
    // Панель есть, но план шаблона не подменен — кнопка «Применить», а не «вернуть».
    expect(screen.getByText(/Рекомендуем сегодня/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Применить рекомендацию' })).toBeInTheDocument()
    expect(readDraft(DRAFT).map((e) => e.exercise.id)).toEqual(['bench', 'ghost'])
  })

  it('все упражнения шаблона уже в составе — сообщение, ничего не добавляется', async () => {
    writeDraft(DRAFT, [entry(bench, [{ weight: 60, reps: 8 }])])
    pickTemplate = { exercises: [{ exercise: bench, sets: 3, reps: 8, weight: 60 }] }
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать шаблон' }))
    fireEvent.click(screen.getByRole('button', { name: 'выбрать шаблон' }))
    expect(await screen.findByText('Все упражнения шаблона уже добавлены.')).toBeInTheDocument()
    expect(readDraft(DRAFT)).toHaveLength(1)
  })

  it('история не читается — шаблон все равно применяется, без панели', async () => {
    vi.mocked(getRecentSessionsForExercise).mockRejectedValue(new Error('idb'))
    pickTemplate = { exercises: [{ exercise: bench, sets: 1, reps: 5, weight: 80 }] }
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать шаблон' }))
    fireEvent.click(screen.getByRole('button', { name: 'выбрать шаблон' }))
    await screen.findByText('Жим лежа')
    expect(weights()).toEqual(['80'])
    expect(screen.queryByText(/Рекомендуем сегодня/)).not.toBeInTheDocument()
  })
})

describe('панель автопрогрессии', () => {
  async function addBenchWithHistory() {
    vi.mocked(getRecentSessionsForExercise).mockResolvedValue(history)
    pickExercise = bench
    render(<WorkoutScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: 'выбрать упражнение' }))
    await screen.findByText(/Рекомендуем сегодня/)
  }

  it('рекомендация применена сразу; «вернуть как в прошлый раз» ↔ «Применить рекомендацию»', async () => {
    await addBenchWithHistory()
    const recommended = weights()
    expect(recommended).toHaveLength(3)
    expect(recommended).not.toEqual(['60', '60', '60'])

    fireEvent.click(screen.getByRole('button', { name: 'вернуть как в прошлый раз' }))
    expect(weights()).toEqual(['60', '60', '60'])
    fireEvent.click(screen.getByRole('button', { name: 'Применить рекомендацию' }))
    expect(weights()).toEqual(recommended)
  })

  it('шестеренка раскрывает стратегии; «ручной» сохраняется и сворачивает подсказку в заглушку', async () => {
    await addBenchWithHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Настройки прогрессии' }))
    expect(screen.getByRole('group', { name: 'Стратегия прогрессии' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ручной' }))
    await waitFor(() => expect(setProgForExercise).toHaveBeenCalledWith('u1', 'bench', { strategy: 'manual' }))
    expect(await screen.findByText('Прогрессия: ручной ввод')).toBeInTheDocument()
    // Применявшим рекомендацию — копия прошлого раза; настройки остаются открытыми.
    expect(weights()).toEqual(['60', '60', '60'])
    expect(screen.getByRole('group', { name: 'Стратегия прогрессии' })).toBeInTheDocument()

    // Шестеренка в заглушке прячет настройки.
    fireEvent.click(screen.getByRole('button', { name: 'Настройки прогрессии' }))
    expect(screen.queryByRole('group', { name: 'Стратегия прогрессии' })).not.toBeInTheDocument()
  })

  it('после ручной правки смена стратегии не трогает введенные подходы', async () => {
    await addBenchWithHistory()
    fireEvent.click(screen.getByRole('button', { name: 'вернуть как в прошлый раз' }))
    fireEvent.change(screen.getAllByLabelText(/^Вес, подход/)[0], { target: { value: '65' } })
    fireEvent.click(screen.getByRole('button', { name: 'Настройки прогрессии' }))
    fireEvent.click(screen.getByRole('button', { name: '+повт.' }))
    await waitFor(() => expect(setProgForExercise).toHaveBeenCalledWith('u1', 'bench', { strategy: 'reps' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Применить рекомендацию' })).toBeInTheDocument())
    expect(weights()).toEqual(['65', '60', '60'])
  })
})

describe('подходы: ввод и степперы', () => {
  it('ввод веса и шаги ± меняют подход в черновике', async () => {
    writeDraft(DRAFT, [entry(bench, [{ weight: 60, reps: 8 }])])
    render(<WorkoutScreen user={user} />)
    fireEvent.change(screen.getByLabelText('Вес, подход 1'), { target: { value: '62.5' } })
    expect(screen.getByLabelText('Вес, подход 1')).toHaveValue('62.5')
    const repsGroup = screen.getByRole('group', { name: 'Подход 1, повторения' })
    const plus = [...repsGroup.querySelectorAll('button')].find((b) => b.textContent === '+')
    fireEvent.pointerDown(plus)
    fireEvent.pointerUp(plus)
    fireEvent.click(plus)
    await waitFor(() => expect(readDraft(DRAFT)[0].sets[0]).toMatchObject({ weight: '62.5' }))
    expect(Number(screen.getByLabelText('Повторения, подход 1').value)).toBeGreaterThan(8)
  })
})

describe('очистка черновика', () => {
  it('«Очистить» → подтверждение → пустой композер, черновик и оценки стерты, экран остается', () => {
    writeDraft(DRAFT, [entry(bench, [{ weight: 60, reps: 8 }])])
    writeDraft(FEEL, { bench: 'easy' })
    const onBack = vi.fn()
    render(<WorkoutScreen user={user} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(screen.getByText(/Очистить черновик\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByText('Жим лежа')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, очистить' }))
    expect(screen.queryByText('Жим лежа')).not.toBeInTheDocument()
    expect(screen.getByText('Добавь упражнение, чтобы начать')).toBeInTheDocument()
    expect(readDraft(DRAFT) ?? []).toEqual([])
    expect(readDraft(FEEL) ?? {}).toEqual({})
    expect(onBack).not.toHaveBeenCalled()
  })
})

describe('действия существующей тренировки', () => {
  const doc = {
    id: 'w1',
    performed_at: '2026-10-05T10:00:00.000Z',
    entries: [{ exercise_id: 'bench', exercise: bench, sets: [{ weight: 60, reps: 8 }, { weight: 0, reps: 0 }] }],
  }
  beforeEach(() => { vi.mocked(getWorkout).mockResolvedValue(doc) })

  it('экспорт — текущий состав формы с id и датой записи', async () => {
    render(<WorkoutScreen user={user} workoutId="w1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Экспорт в JSON/ }))
    expect(exportWorkouts).toHaveBeenCalledOnce()
    const [w] = vi.mocked(exportWorkouts).mock.calls[0]
    expect(w).toMatchObject({ id: 'w1', performed_at: doc.performed_at })
    expect(w.entries).toHaveLength(1)
    expect(w.entries[0].sets.map(({ weight, reps }) => [weight, reps])).toEqual([[60, 8], [0, 0]])
  })

  it('шаблон из тренировки: имя предзаполнено, приватный, синк и тост', async () => {
    render(<><WorkoutScreen user={user} workoutId="w1" /><Toast /></>)
    fireEvent.click(await screen.findByRole('button', { name: /Сделать шаблон из тренировки/ }))
    const name = screen.getByPlaceholderText('Название шаблона')
    expect(name.value).not.toBe('')
    fireEvent.change(name, { target: { value: '  Грудь  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }))

    await waitFor(() => expect(saveTemplate).toHaveBeenCalledOnce())
    const arg = vi.mocked(saveTemplate).mock.calls[0][0]
    expect(arg).toMatchObject({ user_id: 'u1', name: '  Грудь  ', is_public: false })
    expect(arg.exercises).toHaveLength(1)
    expect(syncNow).toHaveBeenCalledWith('u1')
    expect(await screen.findByText('Шаблон создан')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Название шаблона')).not.toBeInTheDocument()
  })

  it('шаблон: пустое имя — кнопка неактивна; отмена; ошибка записи — баннер', async () => {
    vi.mocked(saveTemplate).mockRejectedValueOnce(new Error('квота'))
    render(<WorkoutScreen user={user} workoutId="w1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Сделать шаблон из тренировки/ }))
    fireEvent.change(screen.getByPlaceholderText('Название шаблона'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Создать шаблон' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByPlaceholderText('Название шаблона')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Сделать шаблон из тренировки/ }))
    fireEvent.change(screen.getByPlaceholderText('Название шаблона'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }))
    expect(await screen.findByText('Не удалось создать шаблон: квота')).toBeInTheDocument()
  })

  it('удаление: подтверждение → repo, черновик правки стерт, синк, назад', async () => {
    writeDraft(`workout_edit_${user.id}_w1`, { base: 'other', entries: [] })
    const onBack = vi.fn()
    render(<WorkoutScreen user={user} workoutId="w1" onBack={onBack} />)
    fireEvent.click(await screen.findByRole('button', { name: /Удалить тренировку/ }))
    expect(screen.getByText(/Действие необратимо/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' })) })
    expect(deleteWorkout).toHaveBeenCalledWith('w1')
    expect(syncNow).toHaveBeenCalledWith('u1')
    expect(onBack).toHaveBeenCalledOnce()
    expect(readDraft(`workout_edit_${user.id}_w1`)).toBeFalsy()
  })

  it('удаление без сети — без синка; ошибка — баннер и экран остается', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    vi.mocked(deleteWorkout).mockRejectedValueOnce(new Error('закрыта база'))
    const onBack = vi.fn()
    render(<WorkoutScreen user={user} workoutId="w1" onBack={onBack} />)
    fireEvent.click(await screen.findByRole('button', { name: /Удалить тренировку/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))
    expect(await screen.findByText('Не удалилось: закрыта база')).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
    expect(syncNow).not.toHaveBeenCalled()
  })
})
