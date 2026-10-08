// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useExerciseReorder } from './useExerciseReorder.js'

function Harness({ onMove }) {
  const ref = useExerciseReorder(onMove)
  return <div ref={ref}>{['a', 'b', 'c'].map(id => <div key={id} data-exercise-id={id}>
    <button className="exercise-compact-toggle">{id}</button><input aria-label={id} />
  </div>)}</div>
}
function setup() {
  const onMove = vi.fn()
  const result = render(<Harness onMove={onMove} />)
  const rows = [...result.container.querySelectorAll('[data-exercise-id]')]
  rows.forEach((r, i) => { r.getBoundingClientRect = () => ({ top: i * 100, height: 100 }) })
  const target = rows[2].querySelector('button')
  return { ...result, onMove, rows, target }
}
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] })
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('holds, marks a destination and commits only on release', () => {
  const { target, rows, onMove } = setup()
  fireEvent.touchStart(target, touch(20, 250))
  act(() => vi.advanceTimersByTime(350))
  expect(rows[2]).toHaveClass('exercise-dragging')
  fireEvent.touchMove(target, touch(20, 10))
  expect(rows[0]).toHaveClass('exercise-drop-before')
  expect(onMove).not.toHaveBeenCalled()
  fireEvent.touchEnd(target)
  expect(onMove).toHaveBeenCalledWith('c', 'a')
  expect(rows[2]).not.toHaveClass('exercise-dragging')
})
it('ordinary swipe, touch cancellation and a second finger never reorder', () => {
  const { target, onMove } = setup()
  fireEvent.touchStart(target, touch(20, 250))
  fireEvent.touchMove(target, touch(20, 230))
  act(() => vi.advanceTimersByTime(400))
  fireEvent.touchEnd(target)
  fireEvent.touchStart(target, touch(20, 250))
  act(() => vi.advanceTimersByTime(350))
  fireEvent.touchCancel(target)
  fireEvent.touchStart(target, touch(20, 250))
  act(() => vi.advanceTimersByTime(350))
  fireEvent.touchMove(target, { touches: [{ clientX: 20, clientY: 10 }, { clientX: 40, clientY: 10 }] })
  fireEvent.touchEnd(target)
  expect(onMove).not.toHaveBeenCalled()
})
it('does not start from inputs and cleans up a pending hold on unmount', () => {
  const { container, target, onMove, unmount } = setup()
  fireEvent.touchStart(container.querySelector('input'), touch(20, 250))
  act(() => vi.advanceTimersByTime(400))
  fireEvent.touchEnd(target)
  fireEvent.touchStart(target, touch(20, 250))
  unmount()
  act(() => vi.advanceTimersByTime(400))
  expect(onMove).not.toHaveBeenCalled()
})

it('keyboard moves one position and never intercepts editing an input', () => {
  const { rows, onMove } = setup()
  fireEvent.keyDown(rows[1].querySelector('button'), { altKey: true, key: 'ArrowUp' })
  expect(onMove).toHaveBeenLastCalledWith('b', 'a')
  fireEvent.keyDown(rows[1].querySelector('button'), { altKey: true, key: 'ArrowDown' })
  expect(onMove).toHaveBeenLastCalledWith('b', null)
  fireEvent.keyDown(rows[0].querySelector('button'), { altKey: true, key: 'ArrowUp' })
  fireEvent.keyDown(rows[0].querySelector('input'), { altKey: true, key: 'ArrowDown' })
  expect(onMove).toHaveBeenCalledTimes(2)
})
