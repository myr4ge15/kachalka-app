// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LoadUnitPicker from './LoadUnitPicker.jsx'

it('показывает текущую единицу, выбор передаёт один раз и закрывает лист', () => {
  const select = vi.fn()
  render(<LoadUnitPicker unit="lb" onChange={select} />)
  const trigger = screen.getByRole('button', { name: 'Единица нагрузки: lb' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: /Фунты/ }))
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: /Номер блока/ }))
  expect(select).toHaveBeenCalledWith('block')
  expect(screen.queryByRole('dialog')).toBeNull()
})
