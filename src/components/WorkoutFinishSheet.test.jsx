// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import WorkoutFinishSheet from './WorkoutFinishSheet.jsx'

const workout = {
  entries: [
    { sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }] },
    { sets: [{ weight: 0, reps: 12 }] },
  ],
}

describe('WorkoutFinishSheet', () => {
  it('показывает спокойный итог сохранённой тренировки', () => {
    render(<WorkoutFinishSheet workout={workout} onDone={() => {}} />)

    expect(screen.getByRole('dialog', { name: 'Тренировка готова' })).toBeInTheDocument()
    expect(screen.getByText('Записали. Можно выдохнуть.')).toBeInTheDocument()
    expect(screen.getByText('Упражнения').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText('Подходы').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Тоннаж').nextElementSibling).toHaveTextContent('800 кг')
    expect(screen.queryByText('Время')).not.toBeInTheDocument()
  })

  it('закрывается одной кнопкой «Готово»', () => {
    const onDone = vi.fn()
    render(<WorkoutFinishSheet workout={workout} onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('показывает одно главное событие и открывает его упражнение в Прогрессе', () => {
    const onOpenProgress = vi.fn()
    render(
      <WorkoutFinishSheet
        workout={workout}
        events={[{
          kind: 'pr',
          emoji: '🏆',
          title: 'Новый рекорд!',
          text: 'Жим лёжа — 100 кг (было 95 кг)',
          exerciseId: 'bench',
        }]}
        onDone={() => {}}
        onOpenProgress={onOpenProgress}
      />
    )

    expect(screen.getByText('Новый рекорд!')).toBeInTheDocument()
    expect(screen.getByText('Жим лёжа — 100 кг (было 95 кг)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть прогресс' }))
    expect(onOpenProgress).toHaveBeenCalledWith('bench')
  })

  it('показывает дополнительные события компактно и создаёт шаблон одним тапом', () => {
    const onCreateTemplate = vi.fn()
    const { rerender } = render(
      <WorkoutFinishSheet
        workout={workout}
        events={[
          { kind: 'goal', emoji: '🎯', title: 'Цель достигнута!', text: 'Жим — 100 кг' },
          { kind: 'pr', emoji: '🏆', title: 'Новый рекорд!', text: 'Жим — 100 кг' },
          { kind: 'badge', emoji: '🏆', title: 'Новое достижение!', text: 'Первый шаг' },
        ]}
        onDone={() => {}}
        onCreateTemplate={onCreateTemplate}
      />
    )

    expect(screen.getByRole('list', { name: 'Другие результаты' })).toHaveTextContent('Новый рекорд!')
    expect(screen.getByRole('list', { name: 'Другие результаты' })).toHaveTextContent('Новое достижение!')
    fireEvent.click(screen.getByRole('button', { name: '📋 Сохранить как шаблон' }))
    expect(onCreateTemplate).toHaveBeenCalledOnce()

    rerender(
      <WorkoutFinishSheet
        workout={workout}
        onDone={() => {}}
        onCreateTemplate={onCreateTemplate}
        templateStatus="done"
        templateMessage="Шаблон «Тренировка 30.07» создан"
      />
    )
    expect(screen.getByRole('button', { name: '✓ Шаблон создан' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Шаблон «Тренировка 30.07» создан')
  })
})
