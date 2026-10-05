// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import WorkoutCalendar from './WorkoutCalendar.jsx'

// Сетка, группировка по дням и подписи — чистые lib/calendar.js (свои тесты);
// здесь — поведение листа: листание, запрет будущего, выбор дня, «Открыть».
const BENCH = { id: 'bench', name: 'Жим лежа', muscle_group: 'грудь', submuscle: 'chest_middle', metric: 'weight' }
const wk = (id, day, sets = [{ weight: 80, reps: 5 }]) => ({
  id, performed_at: `${day}T18:00:00`, entries: [{ exercise_id: 'bench', exercise: BENCH, sets }],
})
const WORKOUTS = [wk('w1', '2026-10-02'), wk('w2', '2026-10-02', []), wk('w3', '2026-09-15')]

function open(props = {}) {
  const onOpen = vi.fn()
  render(<WorkoutCalendar workouts={WORKOUTS} onOpen={onOpen} onDismiss={vi.fn()} {...props} />)
  return { onOpen }
}
const title = () => screen.getByRole('grid').getAttribute('aria-label')

describe('WorkoutCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('открывается на текущем месяце: счетчик, сегодня, будущее неактивно, вперед листать нельзя', () => {
    open()
    expect(screen.getByText('2 тренировки')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5, сегодня' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '6' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled()
    expect(screen.getByText(/Нажми на выделенный день/)).toBeInTheDocument()
    // 2+ тренировки за день — маленький счетчик
    expect(screen.getByRole('button', { name: '2, 2 тренировки' })).toHaveTextContent('22')
  })

  it('тап по дню показывает упражнения с подходами и ведет в тренировку с этим днем', () => {
    const { onOpen } = open()
    const day = screen.getByRole('button', { name: '2, 2 тренировки' })
    fireEvent.click(day)
    expect(day).toHaveAttribute('aria-pressed', 'true')
    const cards = document.querySelectorAll('.cal-workout')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Жим лежа')).toBeInTheDocument()
    expect(within(cards[0]).getByText('80×5')).toBeInTheDocument()
    expect(within(cards[1]).getByText('—')).toBeInTheDocument() // без подходов
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Открыть тренировку' }))
    expect(onOpen).toHaveBeenCalledWith('w1', '2026-10-02')
    fireEvent.click(day) // повторный тап снимает выбор
    expect(document.querySelectorAll('.cal-workout')).toHaveLength(0)
  })

  it('день без тренировок — честная подпись', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText('В этот день тренировок не было.')).toBeInTheDocument()
  })

  it('листание назад/вперед сбрасывает выбор; фильтр — в подписи', () => {
    open({ filter: 'Грудь' })
    const before = title()
    fireEvent.click(screen.getByRole('button', { name: '2, 2 тренировки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    expect(title()).not.toBe(before)
    expect(screen.getByText('1 тренировка · Грудь')).toBeInTheDocument()
    expect(document.querySelectorAll('.cal-workout')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(title()).toBe(before)
  })

  it('пустой месяц — «без тренировок» и подсказка', () => {
    open({ workouts: [] })
    expect(screen.getByText('без тренировок')).toBeInTheDocument()
    expect(screen.getByText('В этом месяце тренировок нет.')).toBeInTheDocument()
  })

  it('initialDate открывает нужный месяц с выбранным днем', () => {
    open({ initialDate: '2026-09-15T10:00:00' })
    expect(screen.getByRole('button', { name: '15, 1 тренировка' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelectorAll('.cal-workout')).toHaveLength(1)
  })

  it('свайп по сетке: вправо — прошлый месяц; вертикальный жест не листает; в будущее — нет', () => {
    open()
    const grid = screen.getByRole('grid')
    const now = title()
    const swipe = (x0, y0, x1, y1) => {
      fireEvent.touchStart(grid, { touches: [{ clientX: x0, clientY: y0 }] })
      fireEvent.touchEnd(grid, { changedTouches: [{ clientX: x1, clientY: y1 }] })
    }
    swipe(100, 100, 30, 100) // влево = вперед, но текущий месяц последний
    expect(title()).toBe(now)
    swipe(100, 100, 120, 300) // в основном вертикально
    expect(title()).toBe(now)
    swipe(30, 100, 200, 110)
    expect(title()).not.toBe(now)
    swipe(200, 100, 30, 100)
    expect(title()).toBe(now)
  })
})
