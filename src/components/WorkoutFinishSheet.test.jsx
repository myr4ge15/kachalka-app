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
})
