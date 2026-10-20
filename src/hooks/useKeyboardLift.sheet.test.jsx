// @vitest-environment jsdom
// Поле в листе во весь экран (ветка комментариев, 20.10.2026, fb_904e3fb8): при открытой
// клавиатуре лист ужимается до видимой части над ней — экран не уплывает, поле не под клавиатурой.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { useKeyboardLift } from './useKeyboardLift.js'

class FakeVV extends EventTarget {
  constructor() { super(); this.height = 800; this.offsetTop = 0 }
  set(h, top = 0) { this.height = h; this.offsetTop = top; this.dispatchEvent(new Event('resize')) }
}

function Sheet() {
  const box = useRef(null)
  const lift = useKeyboardLift(box)
  return (
    <div className="overlay" data-testid="overlay">
      <div className="sheet" data-testid="sheet">
        <div className="sheet-scroll" data-testid="scroll">
          <p>комментарии</p>
          <div ref={box}><textarea aria-label="Комментарий" onFocus={lift} /></div>
        </div>
      </div>
      <button type="button">мимо</button>
    </div>
  )
}

let vv
beforeEach(() => {
  vi.useFakeTimers()
  vv = new FakeVV()
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
})
afterEach(() => { vi.useRealTimers(); delete window.visualViewport })

describe('useKeyboardLift — поле в листе', () => {
  it('клавиатура открылась — подложка и лист ровно в видимой полосе; список — к концу', () => {
    const u = render(<Sheet />)
    const scroll = u.getByTestId('scroll')
    Object.defineProperty(scroll, 'scrollHeight', { value: 1500, configurable: true })
    const sheet = u.getByTestId('sheet')
    sheet.scrollTop = 200 // iOS докрутил сам лист к полю — шапка уехала (fb_837481a4)
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(480, 120)) // iOS: видимая часть 480 px, сдвинута на 120 вниз
    expect(sheet.scrollTop).toBe(0)
    expect(sheet).toHaveClass('kb-fit')
    expect(u.getByTestId('sheet').style.height).toBe('480px')
    expect(u.getByTestId('sheet').style.maxHeight).toBe('480px')
    expect(u.getByTestId('overlay').style.top).toBe('120px')
    expect(u.getByTestId('overlay').style.height).toBe('480px')
    expect(scroll.scrollTop).toBe(1500)
  })

  it('клавиатура закрылась — прежние размеры', () => {
    const u = render(<Sheet />)
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(480, 120))
    act(() => vv.set(800, 0))
    expect(u.getByTestId('sheet').style.height).toBe('')
    expect(u.getByTestId('sheet')).not.toHaveClass('kb-fit')
    expect(u.getByTestId('overlay').style.top).toBe('')
  })

  it('фокус ушел из поля — стили сброшены, дальнейшие resize ничего не делают', () => {
    const u = render(<Sheet />)
    const field = u.getByLabelText('Комментарий')
    field.focus()
    fireEvent.focus(field)
    act(() => vv.set(480, 120))
    act(() => { u.getByRole('button', { name: 'мимо' }).focus(); fireEvent.focusOut(field) })
    act(() => { vi.advanceTimersByTime(500) })
    expect(u.getByTestId('sheet').style.height).toBe('')
    act(() => vv.set(400, 0))
    expect(u.getByTestId('sheet').style.height).toBe('')
  })

  it('без клавиатуры (resize на десктопе) — ничего не меняем', () => {
    const u = render(<Sheet />)
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(760, 0)) // меньше 15 % — не клавиатура
    expect(u.getByTestId('sheet').style.height).toBe('')
  })
})
