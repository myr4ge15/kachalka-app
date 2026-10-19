// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import HoldButton from './HoldButton.jsx'
import { HOLD_START } from '../../lib/hold.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Pointer-события в jsdom — MouseEvent с pointerId (координаты нужны для сдвига).
function stubPointer() {
  class TestPointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init)
      this.pointerId = init.pointerId
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
}

function setup() {
  stubPointer()
  const onTrigger = vi.fn()
  render(<HoldButton onTrigger={onTrigger}>+</HoldButton>)
  const button = screen.getByRole('button', { name: '+' })
  let captured = false
  button.setPointerCapture = vi.fn(() => { captured = true })
  button.hasPointerCapture = vi.fn(() => captured)
  button.releasePointerCapture = vi.fn(() => { captured = false })
  return { onTrigger, button }
}

describe('HoldButton', () => {
  it('тап — один шаг на отпускании, не на касании', () => {
    vi.useFakeTimers()
    const { onTrigger, button } = setup()
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 50, clientY: 50 })
    expect(onTrigger).not.toHaveBeenCalled()
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 51, clientY: 52 })
    fireEvent.click(button, { detail: 1 }) // клик после касания второй шаг не дает
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('прокрутка, начатая на кнопке, шаг не добавляет (fb_52059bc8)', () => {
    vi.useFakeTimers()
    const { onTrigger, button } = setup()
    fireEvent.pointerDown(button, { pointerId: 2, button: 0, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(button, { pointerId: 2, clientX: 50, clientY: 20 })
    fireEvent.pointerUp(button, { pointerId: 2, clientX: 50, clientY: 0 })
    act(() => { vi.advanceTimersByTime(HOLD_START * 3) })
    expect(onTrigger).not.toHaveBeenCalled()

    // браузер забрал жест под прокрутку — pointercancel, тоже без шага
    fireEvent.pointerDown(button, { pointerId: 3, button: 0, clientX: 50, clientY: 50 })
    fireEvent.pointerCancel(button, { pointerId: 3 })
    act(() => { vi.advanceTimersByTime(HOLD_START * 3) })
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('клик с клавиатуры — один шаг', () => {
    const { onTrigger, button } = setup()
    fireEvent.click(button, { detail: 0 })
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('захватывает pointer и гарантированно останавливает повтор после отпускания вне кнопки', () => {
    vi.useFakeTimers()
    const { onTrigger, button } = setup()

    fireEvent.pointerDown(button, { pointerId: 7, button: 0 })
    expect(onTrigger).not.toHaveBeenCalled()
    expect(button.setPointerCapture).toHaveBeenCalledWith(7)

    act(() => { vi.advanceTimersByTime(HOLD_START) })
    expect(onTrigger).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(HOLD_START) })
    expect(onTrigger).toHaveBeenCalledTimes(2)

    fireEvent.pointerUp(button, { pointerId: 7 })
    expect(button.releasePointerCapture).toHaveBeenCalledWith(7)
    act(() => { vi.advanceTimersByTime(HOLD_START * 3) })
    expect(onTrigger).toHaveBeenCalledTimes(2) // отпускание после повтора лишнего шага не дает
  })
})
