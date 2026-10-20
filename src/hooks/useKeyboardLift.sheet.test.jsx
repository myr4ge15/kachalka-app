// @vitest-environment jsdom
// Поле в листе во весь экран (ветка комментариев, 20.10.2026, fb_904e3fb8): при открытой
// клавиатуре низ листа поднимается на ее высоту, прокрутка страницы iOS отменяется (переписано 20.10, fb_244e1492).
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
  it('клавиатура открылась — низ листа на ее высоту, прокрутка страницы и листа отменена, список к концу', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const u = render(<Sheet />)
    const scroll = u.getByTestId('scroll')
    Object.defineProperty(scroll, 'scrollHeight', { value: 1500, configurable: true })
    const sheet = u.getByTestId('sheet')
    sheet.scrollTop = 200 // iOS докрутил сам лист к полю
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true }) // и страницу
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(480, 120))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(sheet.scrollTop).toBe(0)
    expect(sheet).toHaveClass('kb-fit')
    expect(sheet.style.getPropertyValue('--kb')).toBe('320px') // 800 − 480, смещение iOS не прибавляем
    // лист и подложку не трогаем: ни высоты, ни сдвига (в iOS 26 строка над клавиатурой прозрачная)
    expect(sheet.style.height).toBe('')
    expect(sheet.style.paddingTop).toBe('')
    expect(u.getByTestId('overlay').style.top).toBe('')
    expect(scroll.scrollTop).toBe(1500)
    Object.defineProperty(scroll, 'clientHeight', { value: 400, configurable: true })
    scroll.scrollTop = 300 // листали список вверх при открытой клавиатуре — повторный resize его не сбрасывает
    act(() => vv.set(470, 0))
    expect(scroll.scrollTop).toBe(300)
    scroll.scrollTop = 1090 // у конца (1500 − 1090 − 400 < 24) — следующий resize держит у конца (fb_82ee17ce)
    act(() => vv.set(460, 0))
    expect(scroll.scrollTop).toBe(1500)
    expect(sheet.style.getPropertyValue('--kb')).toBe('340px')
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    scrollTo.mockRestore()
  })

  it('кадр анимации iOS с нереальной высотой (155 из 800) пропускаем — подъем прежний (fb_f4aa0954)', () => {
    const u = render(<Sheet />)
    const sheet = u.getByTestId('sheet')
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(155, 0))
    expect(sheet).not.toHaveClass('kb-fit')
    act(() => vv.set(480, 0))
    act(() => vv.set(155, 0))
    expect(sheet.style.getPropertyValue('--kb')).toBe('320px')
  })

  it('клавиатура закрылась — без подъема', () => {
    const u = render(<Sheet />)
    const sheet = u.getByTestId('sheet')
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(480, 0))
    act(() => vv.set(800, 0))
    expect(sheet).not.toHaveClass('kb-fit')
    expect(sheet.style.getPropertyValue('--kb')).toBe('')
  })

  it('фокус ушел из поля — подъем снят, дальнейшие resize ничего не делают', () => {
    const u = render(<Sheet />)
    const field = u.getByLabelText('Комментарий')
    field.focus()
    fireEvent.focus(field)
    act(() => vv.set(480, 120))
    act(() => { u.getByRole('button', { name: 'мимо' }).focus(); fireEvent.focusOut(field) })
    act(() => { vi.advanceTimersByTime(500) })
    expect(u.getByTestId('sheet')).not.toHaveClass('kb-fit')
    act(() => vv.set(400, 0))
    expect(u.getByTestId('sheet')).not.toHaveClass('kb-fit')
  })

  it('без клавиатуры (resize на десктопе) — ничего не меняем', () => {
    const u = render(<Sheet />)
    fireEvent.focus(u.getByLabelText('Комментарий'))
    act(() => vv.set(760, 0)) // меньше 15 % — не клавиатура
    expect(u.getByTestId('sheet')).not.toHaveClass('kb-fit')
  })
})
