// @vitest-environment jsdom
// Проводка экрана записи (покрытие 28.10.2026): перетаскивание и корзина (useSortable — свой тест, здесь —
// что экран делает с его колбэками), смена блока (разминка), подход голосом с курсором на следующую строку,
// лист техники только у упражнений каталога с подсказкой. Карточка упражнения — заглушка с теми же props.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readDraft, resetDraftMemory, writeDraft } from '../lib/draftStore.js'
import WorkoutScreen from './WorkoutScreen.jsx'
import Toast from '../components/ui/Toast.jsx'

const BENCH = { id: 'bench', name: 'Жим лежа со штангой', metric: 'weight', muscle_group: 'грудь', secondary: [] }
const PULL = { id: 'pull', name: 'Подтягивания', metric: 'reps', muscle_group: 'спина', secondary: [] }
const MINE = { id: 'mine', name: 'Подтягивания', metric: 'reps', muscle_group: 'спина', secondary: [], is_custom: true }

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (q, _d, fallback) => { const v = q(); return v === undefined || v instanceof Promise ? fallback : v },
}))
vi.mock('../db/repo.js', () => ({
  getExercises: () => [BENCH, PULL, MINE], getWorkout: vi.fn(), getWorkouts: async () => [], saveWorkout: vi.fn(),
  createExercise: vi.fn(), deleteWorkout: vi.fn(), getRecentSessionsForExercise: vi.fn(async () => []),
  getProgSettings: () => undefined, setProgForExercise: vi.fn(), saveTemplate: vi.fn(),
  getWorkoutFeels: vi.fn(async () => ({})), setWorkoutFeels: vi.fn(async () => {}), getFavorites: () => [], toggleFavorite: vi.fn(),
}))
vi.mock('../db/notifications.js', () => ({ detectNewPrsOnSave: vi.fn(async () => []), detectGoalReachedOnSave: vi.fn(async () => []) }))
vi.mock('../db/insights.js', () => ({ detectInsightsOnSave: vi.fn(async () => []) }))
vi.mock('../db/badges.js', () => ({ detectBadgesOnSave: vi.fn(async () => []) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
const sortable = vi.hoisted(() => ({ onMove: null, opts: null }))
vi.mock('../hooks/useSortable.js', () => ({
  useSortable: (onMove, opts) => { sortable.onMove = onMove; sortable.opts = opts; return () => {} },
}))
vi.mock('../components/exercises/ExerciseCard.jsx', () => ({
  default: ({ entry, ei, active, phase, voiceCursor, onTechnique, onPhase, onVoiceSet }) => (
    <div data-testid={`card-${entry.exercise.id}`} data-active={String(active)} data-phase={phase} data-cursor={voiceCursor}>
      {entry.exercise.name}
      {onTechnique && <button onClick={onTechnique}>техника {entry.exercise.id}</button>}
      <button onClick={() => onPhase('warmup')}>в разминку {entry.exercise.id}</button>
      <button onClick={() => onVoiceSet(ei, voiceCursor, { weight: 70, reps: 6 })}>голос {entry.exercise.id}</button>
    </div>
  ),
}))
vi.mock('../components/exercises/TechniqueSheet.jsx', () => ({
  default: ({ slug, name, onClose }) => <div role="dialog" aria-label={`Техника ${name}`} data-slug={slug}><button onClick={onClose}>закрыть технику</button></div>,
}))

const user = { id: 'u1', name: 'Саня' }
const KEY = `workout_draft_new_${user.id}`
const ids = () => readDraft(KEY).map((e) => e.exercise.id)
const card = (id) => screen.getByTestId(`card-${id}`)

function renderWith(entries) {
  writeDraft(KEY, entries)
  return render(<><WorkoutScreen user={user} /><Toast /></>)
}

beforeEach(() => {
  resetDraftMemory()
  localStorage.clear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
})
afterEach(() => vi.clearAllMocks())

const two = () => [
  { exercise: BENCH, sets: [{ weight: 60, reps: 8, _k: 's1' }, { weight: 60, reps: 8, _k: 's2' }] },
  { exercise: PULL, sets: [{ weight: 0, reps: 10, _k: 's3' }] },
]

describe('перетаскивание и корзина', () => {
  it('отпустил на новом месте — порядок в черновике меняется', () => {
    renderWith(two())
    act(() => sortable.onMove('pull', 'bench'))
    expect(ids()).toEqual(['pull', 'bench'])
    expect(screen.getAllByTestId(/^card-/).map((el) => el.dataset.testid)).toEqual(['card-pull', 'card-bench'])
  })

  it('поднял раскрытую карточку — на время жеста она свернута, отпустил — снова раскрыта', () => {
    renderWith(two())
    const activeId = screen.getAllByTestId(/^card-/).find((el) => el.dataset.active === 'true').dataset.testid.slice(5)
    act(() => sortable.opts.onLift('other'))
    expect(card(activeId).dataset.active).toBe('true') // поднята не активная — ничего не сворачиваем
    act(() => sortable.opts.onLift(activeId))
    expect(card(activeId).dataset.active).toBe('false')
    act(() => sortable.opts.onDrop())
    expect(card(activeId).dataset.active).toBe('true')
  })

  it('бросил в корзину — упражнение убрано, «Отменить» возвращает; чужой id — ничего', async () => {
    renderWith(two())
    act(() => sortable.opts.onRemove('nope'))
    expect(ids()).toEqual(['bench', 'pull'])
    act(() => sortable.opts.onRemove('bench'))
    expect(ids()).toEqual(['pull'])
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }))
    expect(ids()).toEqual(['bench', 'pull'])
  })
})

describe('блок, голос, техника', () => {
  it('«в разминку» — фаза в черновике и у карточки, разминка встает первой', () => {
    renderWith(two())
    fireEvent.click(screen.getByRole('button', { name: 'в разминку pull' }))
    expect(readDraft(KEY).find((e) => e.exercise.id === 'pull').phase).toBe('warmup')
    expect(card('pull').dataset.phase).toBe('warmup')
    expect(screen.getAllByTestId(/^card-/)[0]).toBe(card('pull'))
  })

  it('подход голосом пишется в строку курсора, курсор уходит на следующую', () => {
    renderWith(two())
    expect(card('bench').dataset.cursor).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'голос bench' }))
    expect(card('bench').dataset.cursor).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'голос bench' }))
    expect(readDraft(KEY)[0].sets.map(({ weight, reps }) => [weight, reps])).toEqual([[70, 6], [70, 6]])
    expect(card('pull').dataset.cursor).toBe('0')
  })

  it('техника — у упражнения каталога с подсказкой; свое с тем же названием — без нее', () => {
    renderWith([...two(), { exercise: MINE, sets: [{ weight: 0, reps: 5, _k: 's4' }] }])
    expect(screen.queryByRole('button', { name: 'техника mine' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'техника bench' }))
    const sheet = screen.getByRole('dialog', { name: 'Техника Жим лежа со штангой' })
    expect(sheet.dataset.slug).toBe('bench-press')
    fireEvent.click(screen.getByRole('button', { name: 'закрыть технику' }))
    expect(screen.queryByRole('dialog', { name: /Техника/ })).toBeNull()
  })
})
