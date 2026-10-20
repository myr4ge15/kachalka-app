// @vitest-environment jsdom
// Поле в листе во весь экран (ветка комментариев, 20.10.2026, fb_904e3fb8): при открытой
// клавиатуре содержимое листа — в видимой части над ней — экран не уплывает, поле не под клавиатурой.
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
  it('клавиатура открылась — содержимое листа в видимой полосе, лист во весь экран; список — к концу', () => {
    const u = render(<Sheet />)
    const scroll = u.getByTestId('scroll')
    Object.defineProperty(scroll, 'scrollHeight', { value: 1500, configurable: true })
    const sheet = u.getByTestId('sheet')
    sheet.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 })
    sheet.scrollTop = 200 // iOS докрутил сам лист к полю — шапка уехала (fb_837481a4)
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(480, 120)) // iOS: видимая часть 480 px, сдвинута на 120 вниз
    expect(sheet.scrollTop).toBe(0)
    expect(sheet).toHaveClass('kb-fit')
    expect(sheet.style.paddingTop).toMatch(/136px|120px/) // 16 + сдвиг 120 (jsdom сворачивает calc)
    expect(sheet.style.paddingBottom).toBe('208px') // 800 − (120 + 480) + 8
    // fb_83895083: лист и подложку не обрезаем — сквозь прозрачную строку над клавиатурой видно было карточку
    expect(sheet.style.height).toBe('')
    expect(u.getByTestId('overlay').style.top).toBe('')
    expect(scroll.scrollTop).toBe(1500)
  })

  it('клавиатура закрылась — прежние отступы', () => {
    const u = render(<Sheet />)
    const sheet = u.getByTestId('sheet')
    sheet.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 })
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(480, 0))
    expect(sheet.style.paddingBottom).toBe('328px')
    act(() => vv.set(800, 0))
    expect(sheet.style.paddingTop).toBe('')
    expect(sheet.style.paddingBottom).toBe('')
    expect(sheet).not.toHaveClass('kb-fit')
  })

  it('фокус ушел из поля — стили сброшены, дальнейшие resize ничего не делают', () => {
    const u = render(<Sheet />)
    const field = u.getByLabelText('Комментарий')
    field.focus()
    fireEvent.focus(field)
    act(() => vv.set(480, 120))
    act(() => { u.getByRole('button', { name: 'мимо' }).focus(); fireEvent.focusOut(field) })
    act(() => { vi.advanceTimersByTime(500) })
    expect(u.getByTestId('sheet').style.paddingBottom).toBe('')
    act(() => vv.set(400, 0))
    expect(u.getByTestId('sheet').style.paddingBottom).toBe('')
  })

  it('без клавиатуры (resize на десктопе) — ничего не меняем', () => {
    const u = render(<Sheet />)
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(760, 0)) // меньше 15 % — не клавиатура
    expect(u.getByTestId('sheet').style.paddingBottom).toBe('')
  })
})
