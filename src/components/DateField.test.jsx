// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DateField from './DateField.jsx'
import { toDateInput } from '../lib/dates.js'

describe('DateField', () => {
  it('показывает отформатированную дату', () => {
    render(<DateField performedAt="2026-07-23T12:00:00.000Z" onChange={() => {}} />)
    expect(screen.getByText(/^\d{2}\.\d{2}\.\d{4}$/)).toBeInTheDocument()
  })

  it('выбор дня в инпуте → onChange с ISO этого дня (TZ-независимо)', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateField performedAt="2026-07-23T12:00:00.000Z" onChange={onChange} />
    )
    const input = container.querySelector('input[type="date"]')
    fireEvent.change(input, { target: { value: '2026-08-01' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    // round-trip через toDateInput устойчив к часовому поясу (обе стороны локальны)
    expect(toDateInput(onChange.mock.calls[0][0])).toBe('2026-08-01')
  })
})
