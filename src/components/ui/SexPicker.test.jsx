// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SexPicker from './SexPicker.jsx'

describe('SexPicker', () => {
  it('отмечает текущее значение и отдает новое', () => {
    const onChange = vi.fn()
    render(<SexPicker value="f" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Женский' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Не указывать' }))
    expect(onChange).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole('radio', { name: 'Женский' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
  it('без значения выбрано «Не указывать», ошибка видна', () => {
    render(<SexPicker value={null} error="Нет сети" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Не указывать' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Нет сети')
  })
})
