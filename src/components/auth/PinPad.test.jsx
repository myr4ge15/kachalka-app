// @vitest-environment jsdom
// PinPad (UI-ревью 23.10): число набранных цифр озвучивается, физическая клавиатура вводит цифры и стирает.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PinPad from './PinPad.jsx'

const setup = (props = {}) => {
  const onDigit = vi.fn()
  const onBackspace = vi.fn()
  const r = render(<PinPad length={2} busy={false} error="" onDigit={onDigit} onBackspace={onBackspace} {...props} />)
  return { ...r, onDigit, onBackspace }
}

describe('PinPad', () => {
  it('озвучивает, сколько цифр введено', () => {
    setup()
    expect(screen.getByRole('img', { name: 'Введено 2 цифры из 4' })).toBeInTheDocument()
  })

  it('клавиатура: цифры и Backspace; в поле ввода и с модификатором — не перехватывает', () => {
    const { onDigit, onBackspace, container } = setup()
    fireEvent.keyDown(document, { key: '7' })
    fireEvent.keyDown(document, { key: 'Backspace' })
    expect(onDigit).toHaveBeenCalledWith('7')
    expect(onBackspace).toHaveBeenCalledTimes(1)
    const input = document.createElement('input')
    container.append(input)
    fireEvent.keyDown(input, { key: '5' })
    fireEvent.keyDown(document, { key: '1', metaKey: true })
    expect(onDigit).toHaveBeenCalledTimes(1)
  })

  it('во время входа клавиатура молчит; ошибка — alert; кнопки нажимаются', () => {
    const { onDigit, rerender, onBackspace } = setup({ busy: true })
    fireEvent.keyDown(document, { key: '3' })
    expect(onDigit).not.toHaveBeenCalled()
    rerender(<PinPad length={0} busy={false} error="Неверный PIN" onDigit={onDigit} onBackspace={onBackspace} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Неверный PIN')
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Стереть' }))
    expect(onDigit).toHaveBeenCalledWith('4')
    expect(onBackspace).toHaveBeenCalled()
  })
})
