// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { saveTemplate } from '../db/repo.js'
import { emitReselect } from '../lib/appEvents.js'
import HistoryScreen from './HistoryScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/repo.js', () => ({ getWorkouts: vi.fn(), saveTemplate: vi.fn() }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('./WorkoutScreen.jsx', () => ({
  default: ({ workoutId, onSaved, onBack }) => (
    <div data-testid="workout-screen">
      {workoutId ?? 'new'}
      <button onClick={() => onBack?.()}>Назад из тренировки</button>
      <button onClick={() => onSaved?.({ workout, events: [] })}>Сохранить тестовую</button>
      <button onClick={() => onSaved?.({
        workout,
        events: [{
          kind: 'pr',
          emoji: '🏆',
          title: 'Новый рекорд!',
          text: 'Жим лежа — 80 кг (было 75 кг)',
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
  performed_at: '2026-07-29T10:00:00',
  entries: [{
    exercise_id: 'bench',
    exercise: { id: 'bench', name: 'Жим лежа', metric: 'weight', muscle_group: 'грудь' },
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
    fireEvent.click(screen.getByText('Жим лежа').closest('button'))
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

  // Отзыв тестировщицы: из композера тап по УЖЕ активной вкладке «Тренировки»
  // не делал ничего, и добраться до списка (а значит, до шаблонов) можно было
  // только кнопкой «Назад», которая по интуиции ведет на предыдущий экран.
  it('повторный тап по активной вкладке возвращает из композера к списку', async () => {
    render(<HistoryScreen user={user} openNew />)
    expect(screen.getByTestId('workout-screen')).toBeInTheDocument()

    act(() => emitReselect('history'))

    await waitFor(() => expect(screen.queryByTestId('workout-screen')).not.toBeInTheDocument())
    expect(screen.getByText('Мои тренировки')).toBeInTheDocument()
  })

  it('повторный тап по ЧУЖОЙ вкладке хаб не трогает', async () => {
    render(<HistoryScreen user={user} openNew />)
    act(() => emitReselect('feed'))
    await waitFor(() => expect(screen.getByTestId('workout-screen')).toBeInTheDocument())
  })

  it('пустой список зовет записать тренировку', () => {
    vi.mocked(useLiveQuery).mockReturnValue([])
    render(<HistoryScreen user={user} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Записать тренировку' }))
    expect(screen.getByTestId('workout-screen')).toHaveTextContent('new')
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

  it('создает приватный шаблон из сохраненной тренировки прямо в итоге', async () => {
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

  it('иконка календаря открывает лист и закрывает его', () => {
    render(<HistoryScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Календарь тренировок' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Календарь')
    fireEvent.click(screen.getByRole('button', { name: 'закрыть' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('интент openCalendar открывает календарь сразу на нужном дне', () => {
    const onOpenCalendarConsumed = vi.fn()
    render(<HistoryScreen user={user} openCalendar="2026-07-29" onOpenCalendarConsumed={onOpenCalendarConsumed} />)
    expect(onOpenCalendarConsumed).toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Июль 2026')
    expect(dialog).toHaveTextContent('1 тренировка')
    expect(screen.getByRole('button', { name: '29, 1 тренировка' })).toHaveAttribute('aria-pressed', 'true')
    expect(dialog).toHaveTextContent('Жим лежа')
    expect(dialog).toHaveTextContent('80')
    fireEvent.click(screen.getByRole('button', { name: 'Открыть тренировку' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('workout-screen')).toHaveTextContent('w1')
  })

  it('пустой день в календаре честно говорит, что тренировок не было', () => {
    render(<HistoryScreen user={user} openCalendar="2026-07-29" />)
    fireEvent.click(screen.getByRole('button', { name: '28' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('В этот день тренировок не было.')
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Июнь 2026')
    expect(screen.getByRole('dialog')).toHaveTextContent('без тренировок')
  })

  // РЕВЬЮ-КОДА-2026-10-02: «Назад» из тренировки, открытой в календаре, вел в список.
  it('«Назад» из тренировки, открытой в календаре, возвращает календарь на тот же день', () => {
    render(<HistoryScreen user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Календарь тренировок' }))
    // Листаем назад к июлю 2026 от «сегодня» — проще открыть нужный день интентом,
    // но здесь важно, что календарь открыт изнутри экрана (без Ритма).
    let guard = 0
    while (!screen.getByRole('dialog').textContent.includes('Июль 2026') && guard++ < 60) {
      fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    }
    fireEvent.click(screen.getByRole('button', { name: '29, 1 тренировка' }))
    fireEvent.click(screen.getByRole('button', { name: 'Открыть тренировку' }))
    expect(screen.getByTestId('workout-screen')).toHaveTextContent('w1')

    fireEvent.click(screen.getByRole('button', { name: 'Назад из тренировки' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Июль 2026')
    expect(screen.getByRole('button', { name: '29, 1 тренировка' })).toHaveAttribute('aria-pressed', 'true')

    // Повторный «назад» уже не нужен: закрытие календаря — обычный выход к списку.
    fireEvent.click(screen.getByRole('button', { name: 'закрыть' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Мои тренировки')).toBeInTheDocument()
  })

  it('из календаря, открытого Ритмом: «Назад» — в календарь, закрытие — в Ритм', () => {
    const onReturn = vi.fn()
    render(<HistoryScreen user={user} openCalendar="2026-07-29" onReturn={onReturn} />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть тренировку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Назад из тренировки' }))
    expect(onReturn).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Июль 2026')
    fireEvent.click(screen.getByRole('button', { name: 'закрыть' }))
    expect(onReturn).toHaveBeenCalledOnce()
  })

  it('тренировка из списка по «Назад» возвращает в список, без календаря', () => {
    render(<HistoryScreen user={user} />)
    fireEvent.click(screen.getByText('Жим лежа').closest('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Назад из тренировки' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Мои тренировки')).toBeInTheDocument()
  })
})
