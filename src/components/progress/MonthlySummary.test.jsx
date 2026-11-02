// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MonthlySummary from './MonthlySummary.jsx'

afterEach(() => { cleanup(); vi.useRealTimers() })
const w = { id: '1', performed_at: '2026-10-15T12:00:00', entries: [{ exercise: { id: '1', name: 'Жим', metric: 'weight', muscle_group: 'грудь' }, sets: [{ weight: 60, reps: 5 }] }] }
describe('MonthlySummary', () => {
  it('hides the entire section before the first workout', () => {
    render(<MonthlySummary workouts={[]} />)
    expect(screen.queryByRole('region', { name: 'Итоги месяца' })).toBeNull()
  })
  it('navigates months, expands history, and updates after deletion', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 12))
    const { rerender } = render(<MonthlySummary workouts={[w]} />)
    expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть тренировки месяца' }))
    expect(screen.getByText(/Жим:/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(screen.getByText('За этот месяц пока нет тренировок.')).toBeInTheDocument()
    expect(screen.getByText(/Месяц еще идет/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    expect(screen.getByRole('button', { name: 'Посмотреть тренировки месяца' })).toHaveAttribute('aria-expanded', 'false')
    rerender(<MonthlySummary workouts={[{ ...w, _deleted: true }]} />)
    expect(screen.queryByRole('region')).toBeNull()
  })
  it('shows comparisons and records only for a completed month', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 12))
    render(<MonthlySummary workouts={[{ ...w, id: '0', performed_at: '2026-09-01T12:00:00', entries: [{ ...w.entries[0], sets: [{ weight: 50, reps: 5 }] }] }, w]} />)
    expect(screen.getByText(/К прошлому месяцу/)).toBeInTheDocument()
    expect(screen.getByText('Жим: 60 кг')).toBeInTheDocument()
  })
})
