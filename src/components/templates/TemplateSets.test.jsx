// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TemplateSets from './TemplateSets.jsx'

it('для дистанции показывает километры и меняет время с шагом 30 секунд', () => {
  const onChange = vi.fn()
  render(<TemplateSets metric="distance" sets={[{ _k: 'a', weight: 2, reps: 75 }]} onChange={onChange} />)
  expect(screen.getByText('км')).toBeInTheDocument()
  expect(screen.getByText('мин:сек')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Меньше время, подход 1' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith([{ _k: 'a', weight: 2, reps: 45 }])
  fireEvent.click(screen.getByRole('button', { name: 'Больше время, подход 1' }))
  expect(onChange).toHaveBeenLastCalledWith([{ _k: 'a', weight: 2, reps: 105 }])
  fireEvent.click(screen.getByRole('button', { name: 'Меньше, подход 1' }))
  expect(onChange).toHaveBeenLastCalledWith([{ _k: 'a', weight: 1.5, reps: 75 }])
})

it('старый подход без веса использует шаг обычного веса', () => {
  const onChange = vi.fn()
  render(<TemplateSets sets={[{ _k: 'a', reps: 8 }]} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Больше, подход 1' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith([{ _k: 'a', weight: 1.25, reps: 8 }])
})
