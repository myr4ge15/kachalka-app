// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useWorkoutFocus } from './useWorkoutFocus.js'

// Склейка lib/workoutFocus (выбор/заявка) + useRevealFocus. Логика заявок покрыта
// в lib; здесь — что хук отдает согласованный id и прокручивает ТОЛЬКО на переход.
const entry = (id, sets = [{ weight: 50, reps: 10 }]) => ({ exercise: { id, metric: 'weight' }, sets })

let api
function Probe({ entries, preferIncomplete }) {
  api = useWorkoutFocus(entries, { preferIncomplete })
  return <div ref={api.activeCardRef} />
}

describe('useWorkoutFocus', () => {
  let scroll
  beforeEach(() => {
    scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    window.matchMedia = vi.fn(() => ({ matches: false }))
  })
  afterEach(() => {
    delete Element.prototype.scrollIntoView
    delete window.matchMedia
  })

  it('стартовый фокус — первое упражнение, без прокрутки', () => {
    render(<Probe entries={[entry('a'), entry('b')]} />)
    expect(api.activeExerciseId).toBe('a')
    expect(scroll).not.toHaveBeenCalled()
  })

  it('preferIncomplete — стартует с незаполненного', () => {
    render(<Probe entries={[entry('a'), entry('b', [])]} preferIncomplete />)
    expect(api.activeExerciseId).toBe('b')
  })

  it('тап внутри уже активной карточки не уводит экран; переход на другую — центрирует', () => {
    const entries = [entry('a'), entry('b')]
    render(<Probe entries={entries} />)
    act(() => api.activateExercise('a'))
    expect(api.activeExerciseId).toBe('a')
    expect(scroll).not.toHaveBeenCalled()
    act(() => api.activateExercise('b'))
    expect(api.activeExerciseId).toBe('b')
    expect(scroll).toHaveBeenCalledTimes(1)
    act(() => api.activateExercise('b'))
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('удаление активной карточки — id согласуется с актуальным составом', () => {
    const { rerender } = render(<Probe entries={[entry('a'), entry('b')]} />)
    act(() => api.activateExercise('b'))
    rerender(<Probe entries={[entry('a')]} />)
    expect(api.activeExerciseId).toBe('a')
  })

  it('колбэк activateExercise стабилен между рендерами', () => {
    const { rerender } = render(<Probe entries={[entry('a')]} />)
    const first = api.activateExercise
    rerender(<Probe entries={[entry('a'), entry('b')]} />)
    expect(api.activateExercise).toBe(first)
  })
})
