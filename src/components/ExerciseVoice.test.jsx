// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ExercisePicker from './ExercisePicker.jsx'

const catalog = [{ id: 'a', name: 'Жим лежа' }, { id: 'b', name: 'Жим гантелей сидя' }]
let rec
function setup(prefix = 'SpeechRecognition', fail = false) {
  vi.stubGlobal(prefix, class {
    constructor() { rec = this }
    start = vi.fn(() => { if (fail) throw new Error('unavailable') })
    abort = vi.fn()
  })
  const onPick = vi.fn()
  const view = render(<ExercisePicker exercises={catalog} onPick={onPick} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
  return { ...view, onPick }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('voice in ExercisePicker', () => {
  it.each(['SpeechRecognition', 'webkitSpeechRecognition'])('uses %s and requires explicit confirmation', (prefix) => {
    const { onPick } = setup(prefix)
    expect(rec.lang).toBe('ru-RU')
    expect(screen.getByText(/Слушаю/)).toBeInTheDocument()
    act(() => rec.onresult({ results: [Object.assign([{ transcript: 'жим' }], { isFinal: true })] }))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText(/Уточни вариант/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить: Жим лежа' }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(catalog[0])
  })
  it.each(['not-allowed', 'network', 'no-speech', 'audio-capture'])('handles %s and allows retry', (error) => {
    setup()
    act(() => rec.onerror({ error }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('handles start failure', () => {
    setup('SpeechRecognition', true)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось включить')
  })
  it('cancels and ignores stale callbacks, cleans up when scanner opens', () => {
    const { onPick } = setup()
    const old = rec.onresult
    fireEvent.click(screen.getByRole('button', { name: 'Остановить запись' }))
    act(() => old({ results: [Object.assign([{ transcript: 'жим' }], { isFinal: true })] }))
    expect(screen.queryByText(/Распознано:/)).not.toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сканировать название' }))
    expect(rec.abort).toHaveBeenCalledOnce()
    expect(rec.onresult).toBeNull()
  })
  it('times out and aborts on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = setup()
    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByRole('alert')).toHaveTextContent('Время записи')
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    unmount()
    expect(rec.abort).toHaveBeenCalledOnce()
  })
  it('keeps manual search usable without speech support', () => {
    render(<ExercisePicker exercises={catalog} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Назвать упражнение' })).toBeDisabled()
    expect(screen.getByPlaceholderText('Поиск по названию…')).toBeEnabled()
  })
})
