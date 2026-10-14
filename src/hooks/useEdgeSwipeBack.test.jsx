// @vitest-environment jsdom
// Свайп назад от края (v6.8.1): экран едет за пальцем, «Назад» — только когда довели.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useEdgeSwipeBack } from './useEdgeSwipeBack.js'

function Harness({ onBack, enabled = true }) {
  const box = useRef(null)
  const screen = useRef(null)
  useEdgeSwipeBack(box, screen, onBack, enabled)
  return (
    <main data-testid="box" ref={box}>
      <div className="nav-stack" data-testid="stack">
        <div className="nav-layer nav-underlay" data-scroll-top="80" inert aria-hidden="true">предыдущий экран</div>
        <div className="nav-layer nav-current" data-testid="screen" ref={screen}>экран <input data-testid="field" /></div>
      </div>
    </main>
  )
}

const pt = (x, y = 300) => ({ touches: [{ clientX: x, clientY: y }] })

function swipe(box, points) {
  fireEvent.touchStart(box, pt(points[0][0], points[0][1]))
  for (const [x, y] of points.slice(1)) fireEvent.touchMove(box, pt(x, y))
  fireEvent.touchEnd(box, { touches: [] })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useEdgeSwipeBack', () => {
  it('довел от края дальше трети ширины — «Назад»', () => {
    const onBack = vi.fn(() => {
      // До передачи экрана React подложка не скрывается, уходящий не прыгает назад.
      expect(getByTestId('stack').dataset.swiping).toBe('true')
      expect(getByTestId('screen').style.left).toBe('390px')
    })
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    fireEvent.touchStart(box, pt(10))
    fireEvent.touchMove(box, pt(40))
    fireEvent.touchMove(box, pt(200))
    expect(getByTestId('screen').style.left).toBe('190px') // экран за пальцем
    expect(getByTestId('stack').dataset.swiping).toBe('true')
    expect(getByTestId('stack').style.getPropertyValue('--swipe-under-top')).toBe('-80px')
    fireEvent.touchEnd(box, { touches: [] })
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(getByTestId('stack').dataset.swiping).toBeUndefined()
    expect(box.style.overflowY).toBe('')
  })

  it('отпустил рано — экран возвращается, «Назад» нет', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    swipe(box, [[10, 300], [25, 300], [45, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(getByTestId('screen').style.left).toBe('')
  })

  it('от середины экрана — тоже «Назад» (v7.1.7)', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    swipe(box, [[180, 300], [200, 302], [340, 310]])
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('от середины по диагонали — прокрутка, не «Назад»', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    swipe(getByTestId('box'), [[180, 300], [210, 322], [330, 420]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(getByTestId('screen').style.left).toBe('')
  })

  it('от середины по полю ввода — жест поля', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    const input = getByTestId('field')
    fireEvent.touchStart(input, pt(180))
    fireEvent.touchMove(input, pt(220))
    fireEvent.touchMove(input, pt(360))
    fireEvent.touchEnd(input, { touches: [] })
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('вертикальная прокрутка от края — не наш', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    swipe(getByTestId('box'), [[10, 300], [14, 340], [200, 500]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('выключен (верхний уровень или не iOS-PWA) — ничего', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} enabled={false} />)
    swipe(getByTestId('box'), [[10, 300], [40, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('отмена жеста убирает подложку, второй палец тоже отменяет', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    fireEvent.touchStart(box, pt(10))
    fireEvent.touchMove(box, pt(180))
    fireEvent.touchMove(box, { touches: [{ clientX: 190, clientY: 300 }, { clientX: 200, clientY: 320 }] })
    fireEvent.touchEnd(box, { touches: [] })
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(getByTestId('stack').dataset.swiping).toBeUndefined()
    expect(getByTestId('screen').style.left).toBe('')
  })

  it('новый жест во время завершения не вызывает повторный возврат', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    swipe(box, [[10, 300], [200, 300]])
    swipe(box, [[10, 300], [200, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  // v7.5.5: долгое нажатие выделило текст, палец тянет ручку выделения вбок —
  // это выделение, а не «Назад» (раньше экран уезжал из-под пальца).
  it('тянут ручки выделения текста — не «Назад»', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    const spy = vi.spyOn(window, 'getSelection')
    // выделение появилось, пока палец стоял (после touchstart)
    fireEvent.touchStart(box, pt(100))
    spy.mockReturnValue({ isCollapsed: false, toString: () => 'Сегодня' })
    fireEvent.touchMove(box, pt(200))
    fireEvent.touchMove(box, pt(300))
    fireEvent.touchEnd(box, { touches: [] })
    // и новый жест при уже выделенном тексте
    swipe(box, [[100, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(getByTestId('screen').style.left).toBe('')
    spy.mockRestore()
  })

  // v8.4.0: свайп закрывает и открытую тренировку, где упражнения перетаскивают
  // (hooks/useSortable.js гасит touchmove после подъема строки) — такой жест не наш.
  it('палец уже ведет другой жест (touchmove отменен) — не «Назад»', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    const row = getByTestId('screen')
    row.addEventListener('touchmove', (e) => e.preventDefault())
    fireEvent.touchStart(row, pt(100))
    fireEvent.touchMove(row, pt(200))
    fireEvent.touchMove(row, pt(300))
    fireEvent.touchEnd(row, { touches: [] })
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(getByTestId('stack').dataset.swiping).toBeUndefined()
  })

  // v8.4.0: цель касания убрали из DOM — touchend до скроллера не дошел.
  // Следующий жест не должен застревать на «старом».
  it('прошлое касание без touchend не блокирует следующий свайп', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    fireEvent.touchStart(box, pt(100)) // touchend не будет
    swipe(box, [[100, 300], [130, 300], [320, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})


