// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GoalsList from './GoalsList.jsx'

const goal = (over = {}) => ({
  exerciseId: 'e1', exerciseName: 'Жим', metric: 'weight',
  targetWeight: 100, targetReps: 0, achievedAt: null, ...over,
})

const workout = (values) => ({
  entries: Object.entries(values).map(([exerciseId, weight]) => ({
    exercise_id: exerciseId,
    sets: [{ weight, reps: 1 }],
  })),
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

  it('сворачивает длинный список до трёх ближайших к 100% целей', () => {
    const goals = [
      goal({ exerciseId: 'e1', exerciseName: 'Дальняя 20%' }),
      goal({ exerciseId: 'e2', exerciseName: 'Близкая 95%' }),
      goal({ exerciseId: 'e3', exerciseName: 'Средняя 60%' }),
      goal({ exerciseId: 'e4', exerciseName: 'Дальняя 40%' }),
      goal({ exerciseId: 'e5', exerciseName: 'Близкая 80%' }),
    ]
    render(
      <GoalsList
        goalList={goals}
        workouts={[workout({ e1: 20, e2: 95, e3: 60, e4: 40, e5: 80 })]}
        onEdit={() => {}}
        onAdd={() => {}}
      />
    )

    const visibleNames = [...document.querySelectorAll('.goal-top .lbl')]
      .map((node) => node.textContent)
    expect(visibleNames).toEqual([
      expect.stringContaining('Близкая 95%'),
      expect.stringContaining('Близкая 80%'),
      expect.stringContaining('Средняя 60%'),
    ])
    expect(screen.queryByText('Дальняя 40%', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText('Дальняя 20%', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Показать остальные 2/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('раскрывает все цели в порядке прогресса и снова сворачивает список', () => {
    const goals = [20, 95, 60, 40].map((value, index) => goal({
      exerciseId: `e${index}`,
      exerciseName: `Цель ${value}%`,
    }))
    const { container } = render(
      <GoalsList
        goalList={goals}
        workouts={[workout({ e0: 20, e1: 95, e2: 60, e3: 40 })]}
        onEdit={() => {}}
        onAdd={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Показать остальные 1/ }))
    expect([...container.querySelectorAll('.goal-top .lbl')].map((node) => node.textContent)).toEqual([
      expect.stringContaining('Цель 95%'),
      expect.stringContaining('Цель 60%'),
      expect.stringContaining('Цель 40%'),
      expect.stringContaining('Цель 20%'),
    ])

    fireEvent.click(screen.getByRole('button', { name: /Свернуть/ }))
    expect(screen.queryByText('Цель 20%', { exact: false })).not.toBeInTheDocument()
  })

  it('не показывает раскрытие для трёх целей', () => {
    const goals = [1, 2, 3].map((n) => goal({ exerciseId: `e${n}`, exerciseName: `Цель ${n}` }))
    render(<GoalsList goalList={goals} workouts={[]} onEdit={() => {}} onAdd={() => {}} />)
    expect(screen.queryByRole('button', { name: /Показать остальные/ })).not.toBeInTheDocument()
  })

  it('достигнутые цели не вытесняют ближайшие активные и идут отдельной группой', () => {
    const goals = [
      goal({ exerciseId: 'done', exerciseName: 'Готовая', achievedAt: '2026-07-30T12:00:00.000Z' }),
      goal({ exerciseId: 'e1', exerciseName: 'Активная 90%' }),
      goal({ exerciseId: 'e2', exerciseName: 'Активная 70%' }),
      goal({ exerciseId: 'e3', exerciseName: 'Активная 50%' }),
    ]
    render(
      <GoalsList
        goalList={goals}
        workouts={[workout({ done: 100, e1: 90, e2: 70, e3: 50 })]}
        onEdit={() => {}}
        onAdd={() => {}}
      />
    )

    expect(screen.queryByText('Готовая', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByText('Активная 90%', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Показать остальные 1/ }))
    expect(screen.getByText('Достигнутые')).toBeInTheDocument()
    expect(screen.getByText('Готовая', { exact: false })).toBeInTheDocument()
  })

  it('при взятом целевом весе честно показывает оставшееся требование повторов', () => {
    render(
      <GoalsList
        goalList={[goal({ targetReps: 5 })]}
        workouts={[workout({ e1: 100 })]}
        onEdit={() => {}}
        onAdd={() => {}}
      />
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('целевой вес взят · нужно ≥5 повт. в подходе')).toBeInTheDocument()
  })
})
