// @vitest-environment jsdom
// Свайп вниз закрывает нижний лист (v8.8.1; покрытие тестами 20.10.2026: было 32 % строк).
// Лист едет за пальцем; довел или бросил — уезжает и закрывается, иначе возвращается.
// Жест не начинается, если содержимое прокручено, на поле или с горизонтальным движением.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { useSheetSwipeDown } from './useSheetSwipeDown.js'

function Harness({ onDismiss, enabled = true }) {
  const overlay = useRef(null)
  const sheet = useRef(null)
  useSheetSwipeDown(overlay, sheet, onDismiss, enabled)
  return (
    <div data-testid="overlay" ref={overlay}>
      <div data-testid="sheet" ref={sheet}>
        <div className="sheet-scroll" data-testid="scroll">лист <input data-testid="field" /></div>
      </div>
      <div data-testid="outside">фон</div>
    </div>
  )
}

const at = (y, x = 100) => ({ touches: [{ clientX: x, clientY: y }] })
let reduce = false

function setup(props) {
  const onDismiss = vi.fn()
  const u = render(<Harness onDismiss={onDismiss} {...props} />)
  Object.defineProperty(u.getByTestId('sheet'), 'offsetHeight', { value: 400 })
  return { ...u, onDismiss, overlay: u.getByTestId('overlay'), sheet: u.getByTestId('sheet') }
}
// Медленное протягивание: шаги по 20 px с паузой 100 мс (скорость маленькая).
function drag(el, from, to, { slow = true } = {}) {
  fireEvent.touchStart(el, at(from))
  for (let y = from + 20; y <= to; y += 20) fireEvent.touchMove(el, { ...at(y), timeStamp: slow ? y * 10 : y * 0.1 })
  fireEvent.touchEnd(el)
}

beforeEach(() => {
  vi.useFakeTimers()
  reduce = false
  window.matchMedia = vi.fn(() => ({ matches: reduce }))
  window.getSelection = () => null
})
afterEach(() => vi.useRealTimers())

describe('useSheetSwipeDown', () => {
  it('протянул больше четверти высоты — лист уезжает и закрывается', () => {
    const { sheet, onDismiss } = setup()
    fireEvent.touchStart(sheet, at(100))
    fireEvent.touchMove(sheet, { ...at(150), timeStamp: 1000 })
    expect(sheet.style.transform).toBe('translateY(50px)') // едет за пальцем
    fireEvent.touchMove(sheet, { ...at(260), timeStamp: 3000 })
    fireEvent.touchEnd(sheet)
    expect(sheet.style.transform).toBe('translateY(400px)')
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(sheet.style.transform).toBe('')
  })

  it('чуть потянул и отпустил — возвращается, не закрывается', () => {
    const { sheet, onDismiss } = setup()
    drag(sheet, 100, 140)
    expect(sheet.style.transform).toBe('')
    vi.advanceTimersByTime(200)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('содержимое прокручено вниз — это прокрутка, не жест', () => {
    const u = setup()
    u.getByTestId('scroll').scrollTop = 50
    drag(u.sheet, 100, 300)
    vi.advanceTimersByTime(300)
    expect(u.onDismiss).not.toHaveBeenCalled()
  })

  it('на поле ввода и вне листа жест не начинается', () => {
    const u = setup()
    drag(u.getByTestId('field'), 100, 300)
    drag(u.getByTestId('outside'), 100, 300)
    vi.advanceTimersByTime(300)
    expect(u.onDismiss).not.toHaveBeenCalled()
  })

  it('движение вбок — не вниз, жест отпускаем', () => {
    const { sheet, onDismiss } = setup()
    fireEvent.touchStart(sheet, at(100, 100))
    fireEvent.touchMove(sheet, { ...at(105, 180), timeStamp: 100 })
    fireEvent.touchMove(sheet, { ...at(300, 180), timeStamp: 200 })
    fireEvent.touchEnd(sheet)
    vi.advanceTimersByTime(300)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('второй палец или отмена касания — лист возвращается', () => {
    const { sheet, onDismiss } = setup()
    fireEvent.touchStart(sheet, at(100))
    fireEvent.touchMove(sheet, { ...at(200), timeStamp: 1000 })
    fireEvent.touchCancel(sheet)
    vi.advanceTimersByTime(200)
    expect(sheet.style.transform).toBe('')
    fireEvent.touchStart(sheet, at(100))
    fireEvent.touchMove(sheet, { ...at(200), timeStamp: 1000 })
    fireEvent.touchMove(sheet, { touches: [{ clientX: 1, clientY: 1 }, { clientX: 2, clientY: 2 }], timeStamp: 1100 })
    vi.advanceTimersByTime(200)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('«уменьшить движение» — без езды за пальцем, закрытие сразу', () => {
    reduce = true
    const { sheet, onDismiss } = setup()
    fireEvent.touchStart(sheet, at(100))
    fireEvent.touchMove(sheet, { ...at(150), timeStamp: 1000 })
    expect(sheet.style.transform).toBe('')
    fireEvent.touchMove(sheet, { ...at(300), timeStamp: 3000 })
    fireEvent.touchEnd(sheet)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('выключен — жест не слушаем', () => {
    const { sheet, onDismiss } = setup({ enabled: false })
    drag(sheet, 100, 350)
    vi.advanceTimersByTime(300)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
