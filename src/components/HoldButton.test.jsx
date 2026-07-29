// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import HoldButton from './HoldButton.jsx'
import { HOLD_START } from '../lib/hold.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HoldButton', () => {
  it('захватывает pointer и гарантированно останавливает повтор после отпускания вне кнопки', () => {
    vi.useFakeTimers()
    class TestPointerEvent extends MouseEvent {
      constructor(type, init = {}) {
        super(type, init)
        this.pointerId = init.pointerId
      }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    const onTrigger = vi.fn()
    render(<HoldButton onTrigger={onTrigger}>+</HoldButton>)
    const button = screen.getByRole('button', { name: '+' })
    let captured = false
    button.setPointerCapture = vi.fn(() => { captured = true })
    button.hasPointerCapture = vi.fn(() => captured)
    button.releasePointerCapture = vi.fn(() => { captured = false })

    fireEvent.pointerDown(button, { pointerId: 7, button: 0 })
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(button.setPointerCapture).toHaveBeenCalledWith(7)

    act(() => { vi.advanceTimersByTime(HOLD_START) })
    expect(onTrigger).toHaveBeenCalledTimes(2)

    fireEvent.pointerUp(button, { pointerId: 7 })
    expect(button.releasePointerCapture).toHaveBeenCalledWith(7)
    act(() => { vi.advanceTimersByTime(HOLD_START * 3) })
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })
})
