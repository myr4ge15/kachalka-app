// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DateField from './DateField.jsx'
import { toDateInput } from '../lib/dates.js'

// Фикстуры — ЛОКАЛЬНОЕ время без Z: «12:00Z» в UTC+14 уже следующий день, и
// подпись «23 июля» зависела бы от пояса машины (CI, разработчик в другом поясе).
describe('DateField', () => {
  it('показывает дату словами и подписанный инпут', () => {
    render(<DateField performedAt="2026-07-23T12:00:00" onChange={() => {}} />)
    expect(screen.getByText(/23 июля/)).toBeInTheDocument()
    expect(screen.getByLabelText('Дата тренировки')).toHaveAttribute('type', 'date')
    // без кнопки «Сбросить» в пикере iOS
    expect(screen.getByLabelText('Дата тренировки')).toBeRequired()
  })

  it('выбор дня в инпуте → onChange с ISO этого дня (TZ-независимо)', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateField performedAt="2026-07-23T12:00:00" onChange={onChange} />
    )
    const input = container.querySelector('input[type="date"]')
    fireEvent.change(input, { target: { value: '2026-08-01' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    // round-trip через toDateInput устойчив к часовому поясу (обе стороны локальны)
    expect(toDateInput(onChange.mock.calls[0][0])).toBe('2026-08-01')
  })

  it('сброс без change (iOS): пустое поле при закрытии пикера → сегодня', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateField performedAt="2026-07-23T12:00:00" onChange={onChange} />
    )
    const input = container.querySelector('input[type="date"]')
    input.value = ''
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(toDateInput(onChange.mock.calls[0][0])).toBe(toDateInput())
  })

  it('закрытие пикера без изменений не вызывает onChange', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateField performedAt="2026-07-23T12:00:00" onChange={onChange} />
    )
    fireEvent.blur(container.querySelector('input[type="date"]'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('«Сбросить» в пикере (пустое значение) → сегодняшняя дата', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateField performedAt="2026-07-23T12:00:00" onChange={onChange} />
    )
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(toDateInput(onChange.mock.calls[0][0])).toBe(toDateInput())
  })
})

describe('DateField — будущая дата', () => {
  it('у поля стоит max = сегодня', () => {
    render(<DateField performedAt="2026-07-23T12:00:00" onChange={() => {}} />)
    expect(screen.getByLabelText('Дата тренировки')).toHaveAttribute('max', toDateInput())
  })

  it('введенная вручную будущая дата прижимается к сегодня', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DateField performedAt="2026-07-23T12:00:00" onChange={onChange} />
    )
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2099-01-01' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(toDateInput(onChange.mock.calls[0][0])).toBe(toDateInput())
  })
})
