// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { getExercises } from '../../db/repo.js'
import MuscleExercises from './MuscleExercises.jsx'

vi.mock('../../db/repo.js', () => ({ getExercises: vi.fn() }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (read) => read() }))

describe('каталог в восстановлении', () => {
  it('читает при раскрытии, показывает основные мышцы и учитывает старую разметку', () => {
    getExercises.mockReturnValue([
      { id: 'a', name: 'Подтягивания', submuscle: 'lats' },
      { id: 'b', name: 'Тяга', muscle_group: 'спина', submuscle: '' },
      { id: 'c', name: 'Пуловер', submuscle: 'chest_middle', secondary: ['lats'] },
    ])
    render(<MuscleExercises submuscle="lats" />)
    const toggle = screen.getByRole('button', { name: 'Показать упражнения' })
    expect(getExercises).not.toHaveBeenCalled()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Подтягивания', 'Тяга'])
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть упражнения' }))
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('различает чтение базы и пустой список', () => {
    getExercises.mockReturnValue(undefined)
    const { rerender } = render(<MuscleExercises submuscle="forearms" />)
    fireEvent.click(screen.getByRole('button', { name: 'Показать упражнения' }))
    expect(screen.getByText('Загружаем упражнения…')).toBeVisible()
    getExercises.mockReturnValue([])
    rerender(<MuscleExercises submuscle="forearms" />)
    expect(screen.getByText('В каталоге пока нет упражнений на эту мышцу.')).toBeVisible()
  })
})
