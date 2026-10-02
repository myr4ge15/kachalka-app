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
      <div data-testid="screen" ref={screen}>экран</div>
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
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    fireEvent.touchStart(box, pt(10))
    fireEvent.touchMove(box, pt(40))
    fireEvent.touchMove(box, pt(200))
    expect(getByTestId('screen').style.left).toBe('190px') // экран за пальцем
    fireEvent.touchEnd(box, { touches: [] })
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
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

  it('не от края — жест не наш', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    swipe(getByTestId('box'), [[80, 300], [120, 300], [300, 300]])
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(getByTestId('screen').style.left).toBe('')
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
})
