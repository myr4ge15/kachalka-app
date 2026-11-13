// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MonthlySummary from './MonthlySummary.jsx'

beforeEach(() => vi.setSystemTime(new Date(2026, 10, 15, 12)))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const month = { year: 2026, month: 9 }
const w = { id: '1', performed_at: '2026-10-15T12:00:00', entries: [{ exercise: { id: '1', name: 'Жим', metric: 'weight', muscle_group: 'грудь' }, sets: [{ weight: 60, reps: 5 }] }] }
describe('MonthlySummary', () => {
  it('opens a separate dialog and routes to workouts instead of rendering a list', () => {
    const onOpenWorkouts = vi.fn()
    const onDismiss = vi.fn()
    render(<MonthlySummary workouts={[w]} month={month} onOpenWorkouts={onOpenWorkouts} onDismiss={onDismiss} />)
    expect(screen.getByRole('dialog', { name: 'Итоги месяца' })).toBeInTheDocument()
    expect(screen.getByText('Рабочие подходы')).toBeInTheDocument()
    expect(screen.getByText('Тоннаж')).toBeInTheDocument()
    expect(screen.getByText('300 кг')).toBeInTheDocument()
    expect(screen.getByText('Чаще всего')).toBeInTheDocument()
    expect(screen.getByText('На 1 тренировке')).toBeInTheDocument()
    expect(screen.queryByText(/Жим:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Тренировки за месяц' }))
    expect(onOpenWorkouts).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
  it('shows records and a readable comparison without a huge growth percentage', () => {
    render(<MonthlySummary month={month} workouts={[{ ...w, id: '0', performed_at: '2026-09-01T12:00:00', entries: [{ ...w.entries[0], sets: [{ weight: 50, reps: 5 }] }] }, w]} />)
    expect(screen.getByText('Столько же тренировок, сколько в прошлом месяце')).toBeInTheDocument()
    expect(screen.getByText('60 кг')).toBeInTheDocument()
    expect(screen.getAllByText('Жим')).toHaveLength(2)
  })
  it('handles an empty month and persistence errors', () => {
    render(<MonthlySummary month={month} workouts={[]} error />)
    expect(screen.getByText('За этот месяц пока нет тренировок.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Тренировки за месяц' })).toBeNull()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('открывает архив, помечает текущий выбор и передает выбранный месяц', () => {
    const months = Array.from({ length: 10 }, (_, index) => ({ year: 2026, month: 9 - index }))
    const onMonthChange = vi.fn()
    render(<MonthlySummary workouts={[w]} month={month} months={months} onMonthChange={onMonthChange} />)
    const trigger = screen.getByRole('button', { name: 'Выбрать месяц' })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: /октябрь 2026/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByText('2026', { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: /март 2026/ }))
    expect(onMonthChange).toHaveBeenCalledExactlyOnceWith({ year: 2026, month: 2 })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('по умолчанию выбирает предыдущий месяц и скрывает итоги во время загрузки', () => {
    render(<MonthlySummary workouts={[w]} loading />)
    expect(screen.getByText(/октябрь 2026/)).toBeInTheDocument()
    expect(screen.queryByText('Рабочие подходы')).toBeNull()
  })

  it.each([
    [1, 2, 'На 1 тренировку меньше, чем в прошлом месяце'],
    [2, 1, 'На 1 тренировку больше, чем в прошлом месяце'],
  ])('сравнивает %i тренировок с %i', (current, previous, message) => {
    const workouts = [
      ...Array.from({ length: current }, (_, i) => ({ ...w, id: `current-${i}` })),
      ...Array.from({ length: previous }, (_, i) => ({ ...w, id: `previous-${i}`, performed_at: '2026-09-15T12:00:00' })),
    ]
    render(<MonthlySummary workouts={workouts} month={month} celebrate={false} />)
    expect(screen.getByText(message)).toBeInTheDocument()
  })
})
