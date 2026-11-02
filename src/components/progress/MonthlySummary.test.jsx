// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MonthlySummary from './MonthlySummary.jsx'

afterEach(cleanup)
const month = { year: 2026, month: 9 }
const w = { id: '1', performed_at: '2026-10-15T12:00:00', entries: [{ exercise: { id: '1', name: 'Жим', metric: 'weight', muscle_group: 'грудь' }, sets: [{ weight: 60, reps: 5 }] }] }
describe('MonthlySummary', () => {
  it('opens a separate dialog and routes to workouts instead of rendering a list', () => {
    const onOpenWorkouts = vi.fn()
    const onDismiss = vi.fn()
    render(<MonthlySummary workouts={[w]} month={month} onOpenWorkouts={onOpenWorkouts} onDismiss={onDismiss} />)
    expect(screen.getByRole('dialog', { name: 'Итоги месяца' })).toBeInTheDocument()
    expect(screen.getByText('Рабочие подходы')).toBeInTheDocument()
    expect(screen.queryByText(/Жим:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Тренировки за месяц' }))
    expect(onOpenWorkouts).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
  it('shows records and a readable comparison without a huge growth percentage', () => {
    render(<MonthlySummary month={month} workouts={[{ ...w, id: '0', performed_at: '2026-09-01T12:00:00', entries: [{ ...w.entries[0], sets: [{ weight: 50, reps: 5 }] }] }, w]} />)
    expect(screen.getByText(/Столько же тренировок/)).toBeInTheDocument()
    expect(screen.getByText('60 кг')).toBeInTheDocument()
    expect(screen.getByText('Жим')).toBeInTheDocument()
  })
  it('handles an empty month and persistence errors', () => {
    render(<MonthlySummary month={month} workouts={[]} error />)
    expect(screen.getByText('За этот месяц пока нет тренировок.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Тренировки за месяц' })).toBeNull()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
