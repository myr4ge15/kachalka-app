// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LoadUnitPicker from './LoadUnitPicker.jsx'

it('показывает единицу из карточки и меняет её через список', () => {
  const onChange = vi.fn()
  const view = render(<LoadUnitPicker onChange={onChange} />)
  const select = screen.getByRole('combobox', { name: 'Единица нагрузки' })
  expect(select).toHaveValue('kg')
  expect([...select.options].map(option => option.text)).toEqual(['Килограммы (кг)', 'Фунты (lb)', 'Номер блока'])
  view.rerender(<LoadUnitPicker unit="lb" onChange={onChange} />)
  expect(select).toHaveValue('lb')
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.change(select, { target: { value: 'block' } })
  expect(onChange).toHaveBeenCalledExactlyOnceWith('block')
})
