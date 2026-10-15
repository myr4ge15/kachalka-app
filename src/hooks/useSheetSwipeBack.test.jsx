// @vitest-environment jsdom
// Свайп «назад» по листу (v8.1.1): лист едет за пальцем, закрывается только когда довели
// или бросили; поле и вертикаль жест не забирают (аудит 14.10 — у хука не было теста).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useSheetSwipeBack } from './useSheetSwipeBack.js'

function Harness({ onDismiss, enabled = true }) {
  const overlay = useRef(null)
  const sheet = useRef(null)
  useSheetSwipeBack(overlay, sheet, onDismiss, enabled)
  return (
    <div data-testid="overlay" ref={overlay}>
      <div data-testid="sheet" ref={sheet}>
        лист <input data-testid="field" />
      </div>
    </div>
  )
}

const pt = (x, y = 300) => ({ touches: [{ clientX: x, clientY: y }] })

function setup(props) {
  const onDismiss = vi.fn()
  const utils = render(<Harness onDismiss={onDismiss} {...props} />)
  Object.defineProperty(utils.getByTestId('sheet'), 'clientWidth', { value: 390 })
  return { ...utils, onDismiss, overlay: utils.getByTestId('overlay'), sheet: utils.getByTestId('sheet') }
}

beforeEach(() => {
  vi.useFakeTimers()
  window.matchMedia = vi.fn(() => ({ matches: false }))
})
afterEach(() => vi.useRealTimers())

describe('useSheetSwipeBack', () => {
  it('довел дальше трети ширины — лист уезжает и закрывается', () => {
    const { overlay, sheet, onDismiss } = setup()
    fireEvent.touchStart(overlay, pt(10))
    fireEvent.touchMove(overlay, pt(40))
    fireEvent.touchMove(overlay, pt(200))
    expect(sheet.style.transform).toBe('translateX(190px)') // лист за пальцем
    fireEvent.touchEnd(overlay, { touches: [] })
    expect(sheet.style.transform).toBe('translateX(390px)') // уезжает вправо
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(sheet.style.transform).toBe('')
  })

  it('отпустил рано и медленно — лист возвращается, не закрывается', () => {
    const { overlay, sheet, onDismiss } = setup()
    fireEvent.touchStart(overlay, pt(10))
    vi.advanceTimersByTime(300)
    fireEvent.touchMove(overlay, pt(40))
    vi.advanceTimersByTime(300)
    fireEvent.touchMove(overlay, pt(90)) // 50 px за 300 мс — не бросок
    fireEvent.touchEnd(overlay, { touches: [] })
    vi.advanceTimersByTime(200)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('вертикальный жест — прокрутка листа, не «назад»', () => {
    const { overlay, sheet, onDismiss } = setup()
    fireEvent.touchStart(overlay, pt(100, 300))
    fireEvent.touchMove(overlay, pt(110, 200))
    fireEvent.touchMove(overlay, pt(300, 100))
    fireEvent.touchEnd(overlay, { touches: [] })
    vi.advanceTimersByTime(200)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('жест с поля (не от края) уступает полю', () => {
    const { overlay, getByTestId, onDismiss, sheet } = setup()
    fireEvent.touchStart(getByTestId('field'), pt(120))
    fireEvent.touchMove(overlay, pt(160))
    fireEvent.touchMove(overlay, pt(330))
    fireEvent.touchEnd(overlay, { touches: [] })
    vi.advanceTimersByTime(200)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('второй палец посреди жеста — отмена, лист на место', () => {
    const { overlay, sheet, onDismiss } = setup()
    fireEvent.touchStart(overlay, pt(10))
    fireEvent.touchMove(overlay, pt(40))
    fireEvent.touchMove(overlay, pt(200))
    fireEvent.touchMove(overlay, { touches: [{ clientX: 210, clientY: 300 }, { clientX: 50, clientY: 400 }] })
    vi.advanceTimersByTime(200)
    fireEvent.touchEnd(overlay, { touches: [] })
    expect(onDismiss).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('выключен (не iOS «на экране Домой») — жест не обрабатывается', () => {
    const { overlay, sheet, onDismiss } = setup({ enabled: false })
    fireEvent.touchStart(overlay, pt(10))
    fireEvent.touchMove(overlay, pt(40))
    fireEvent.touchMove(overlay, pt(300))
    fireEvent.touchEnd(overlay, { touches: [] })
    vi.advanceTimersByTime(200)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('reduced motion — лист за пальцем не едет, но довел — закрывается сразу', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }))
    const { overlay, sheet, onDismiss } = setup()
    fireEvent.touchStart(overlay, pt(10))
    fireEvent.touchMove(overlay, pt(40))
    fireEvent.touchMove(overlay, pt(250))
    expect(sheet.style.transform).toBe('')
    fireEvent.touchEnd(overlay, { touches: [] })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
