// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GoalsList from './GoalsList.jsx'

const goal = (over = {}) => ({
  exerciseId: 'e1', exerciseName: 'Жим', metric: 'weight',
  targetWeight: 100, targetReps: 0, achievedAt: null, ...over,
})

describe('GoalsList', () => {
  it('рендерит цель с прогресс-баром (нет истории → 0%) и зовёт onEdit/onAdd', () => {
    const g = goal()
    const onEdit = vi.fn(); const onAdd = vi.fn()
    render(<GoalsList goalList={[g]} workouts={[]} onEdit={onEdit} onAdd={onAdd} />)
    expect(screen.getByText('Жим', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✎ Изменить цель'))
    expect(onEdit).toHaveBeenCalledWith(g)
    fireEvent.click(screen.getByText('+ Добавить цель'))
    expect(onAdd).toHaveBeenCalled()
  })

  it('достигнутая цель → «🎯 Цель достигнута!»', () => {
    render(<GoalsList goalList={[goal({ achievedAt: '2026-01-01T00:00:00.000Z' })]} workouts={[]} onEdit={() => {}} onAdd={() => {}} />)
    expect(screen.getByText('🎯 Цель достигнута!')).toBeInTheDocument()
  })

  it('весовая цель с targetReps → «× N» и «нужно ≥N повт.»', () => {
    render(<GoalsList goalList={[goal({ targetReps: 5 })]} workouts={[]} onEdit={() => {}} onAdd={() => {}} />)
    expect(screen.getByText(/× 5/)).toBeInTheDocument()
    expect(screen.getByText(/нужно ≥5 повт/)).toBeInTheDocument()
  })
})
