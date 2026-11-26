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

it('у изометрии вес снаряда редактируется и останавливается на верхней границе', () => {
  const onChange = vi.fn()
  render(<TemplateSets metric="time" sets={[{ _k: 'a', weight: 1000, reps: 30 }]} onChange={onChange} />)
  expect(screen.getByLabelText('Вес или дистанция подхода 1')).toHaveValue('1000')
  fireEvent.click(screen.getByRole('button', { name: 'Больше, подход 1' }))
  expect(onChange).toHaveBeenLastCalledWith([{ _k: 'a', weight: 1000, reps: 30 }])
  fireEvent.click(screen.getByRole('button', { name: 'Меньше, подход 1' }))
  expect(onChange).toHaveBeenLastCalledWith([{ _k: 'a', weight: 998.75, reps: 30 }])
})
it('меняет номер блока шаблона и сохраняет нулевой вклад в тоннаж', () => {
  const onChange = vi.fn()
  render(<TemplateSets metric="weight" sets={[{ _k: 'a', weight: 0, reps: 12, load_input: { unit: 'block', value: 7 } }]} onChange={onChange} />)
  expect(screen.getByText('Номер блока')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Больше, подход 1' }))
  expect(onChange.mock.lastCall[0][0]).toMatchObject({ weight: 0, load_input: { unit: 'block', value: 8 } })
  fireEvent.change(screen.getByLabelText('Вес или дистанция подхода 1'), { target: { value: '9' } })
  expect(onChange.mock.lastCall[0][0].load_input.value).toBe('9')
})
