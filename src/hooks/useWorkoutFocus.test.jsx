// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useWorkoutFocus } from './useWorkoutFocus.js'
import { readDraft, resetDraftMemory } from '../lib/draftStore.js'

// Склейка lib/workoutFocus (выбор/заявка) + useRevealFocus. Логика заявок покрыта
// в lib; здесь — что хук отдает согласованный id и прокручивает ТОЛЬКО на переход.
const entry = (id, sets = [{ weight: 50, reps: 10 }]) => ({ exercise: { id, metric: 'weight' }, sets })

let api
function Probe({ entries, preferIncomplete, storeKey }) {
  api = useWorkoutFocus(entries, { preferIncomplete, storeKey })
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
    localStorage.clear()
    resetDraftMemory()
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

  it('storeKey: выбранное упражнение переживает размонтирование (уход на другую вкладку, fb_0f3069ec)', () => {
    const entries = [entry('a'), entry('b'), entry('c')]
    const { unmount } = render(<Probe entries={entries} storeKey="focus_t" />)
    act(() => api.activateExercise('c'))
    expect(readDraft('focus_t')).toBe('c')
    unmount()
    scroll.mockClear()
    render(<Probe entries={entries} storeKey="focus_t" />)
    expect(api.activeExerciseId).toBe('c')
    expect(scroll).not.toHaveBeenCalled() // возврат — не переход, плавного reveal нет
  })

  it('storeKey: восстановленная карточка через два кадра встает по центру .content', () => {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (fn) => frames.push(fn))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      const entries = [entry('a'), entry('b'), entry('c')]
      const first = render(<Probe entries={entries} storeKey="focus_t" />)
      act(() => api.activateExercise('c'))
      first.unmount()
      frames.length = 0
      const box = document.createElement('div')
      box.className = 'content'
      document.body.appendChild(box)
      render(<Probe entries={entries} storeKey="focus_t" />, { container: box })
      box.getBoundingClientRect = () => ({ top: 0, height: 600 })
      box.firstChild.getBoundingClientRect = () => ({ top: 900, height: 200 })
      expect(frames).toHaveLength(1)
      frames.shift()() // кадр 1: HistoryScreen еще ставит позицию наверх
      expect(box.scrollTop).toBe(0)
      frames.shift()() // кадр 2: центр карточки — по центру экрана
      expect(box.scrollTop).toBe(700)
      box.remove()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('без восстановления (первое открытие) экран не трогаем', () => {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (fn) => frames.push(fn))
    try {
      render(<Probe entries={[entry('a'), entry('b')]} storeKey="focus_t" />)
      expect(frames).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('storeKey: сохраненного упражнения уже нет в составе — первое', () => {
    const { unmount } = render(<Probe entries={[entry('a'), entry('b')]} storeKey="focus_t" />)
    act(() => api.activateExercise('b'))
    unmount()
    render(<Probe entries={[entry('a')]} storeKey="focus_t" />)
    expect(api.activeExerciseId).toBe('a')
  })
})
