// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TimeInput from './TimeInput.jsx'

function Host({ initial = 60 }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <TimeInput value={v} onChange={setV} aria-label="Время" />
      <output data-testid="sec">{v}</output>
      <button onClick={() => setV((x) => x + 5)}>+</button>
    </>
  )
}

describe('TimeInput', () => {
  it('поле можно стереть и набрать заново', async () => {
    const user = userEvent.setup()
    render(<Host />)
    const input = screen.getByLabelText('Время')
    await user.click(input)
    await user.clear(input)
    expect(input).toHaveValue('')
    await user.type(input, '1:30')
    expect(input).toHaveValue('1:30')
    expect(screen.getByTestId('sec')).toHaveTextContent('90')
  })

  it('выделить все и набрать «1:30» дает 1:30, а не 2:10', async () => {
    const user = userEvent.setup()
    render(<Host />)
    const input = screen.getByLabelText('Время')
    await user.click(input) // фокус выделяет все
    await user.keyboard('1:30')
    expect(screen.getByTestId('sec')).toHaveTextContent('90')
  })

  it('голые секунды и точка вместо двоеточия; на blur — красивый формат', async () => {
    const user = userEvent.setup()
    render(<Host />)
    const input = screen.getByLabelText('Время')
    await user.click(input)
    await user.keyboard('45')
    expect(screen.getByTestId('sec')).toHaveTextContent('45')
    await user.tab()
    expect(input).toHaveValue('0:45')
    await user.click(input)
    await user.keyboard('2.05')
    await user.tab()
    expect(input).toHaveValue('2:05')
    expect(screen.getByTestId('sec')).toHaveTextContent('125')
  })

  it('вне фокуса показывает значение от родителя (степпер)', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByText('+'))
    expect(screen.getByLabelText('Время')).toHaveValue('1:05')
  })
})
