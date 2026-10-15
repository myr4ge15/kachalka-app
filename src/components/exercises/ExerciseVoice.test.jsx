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
    expect(screen.queryByText(/iOS PWA|Голос может требовать интернет/)).not.toBeInTheDocument()
    expect(rec.lang).toBe('ru-RU')
    act(() => rec.onaudiostart())
    expect(screen.getByText(/Слушаю/)).toBeInTheDocument()
    act(() => rec.onresult({ results: [Object.assign([{ transcript: 'жим' }], { isFinal: true })] }))
    expect(rec.abort).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText(/Уточни вариант/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить: Жим лежа' }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(catalog[0])
  })
  it.each(['not-allowed', 'network', 'no-speech', 'audio-capture'])('handles %s and allows retry', (error) => {
    setup()
    act(() => rec.onerror({ error }))
    expect(rec.abort).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('handles start failure', () => {
    setup('SpeechRecognition', true)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось включить')
  })
  it('releases capture after a result even if the browser never sends end', () => {
    vi.useFakeTimers()
    const { onPick } = setup('webkitSpeechRecognition')
    act(() => rec.onaudiostart())
    const lateResult = rec.onresult
    act(() => rec.onresult({ results: [Object.assign([{ transcript: 'жим' }], { isFinal: true })] }))
    expect(rec.abort).toHaveBeenCalledOnce()
    expect(rec.onresult).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить выбор' }))
    act(() => {
      lateResult({ results: [Object.assign([{ transcript: 'жим' }], { isFinal: true })] })
      vi.advanceTimersByTime(15000)
    })
    expect(screen.queryByText('Распознано')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    expect(rec.start).toHaveBeenCalledOnce()
  })
  it('does not abort again after a natural end', () => {
    setup()
    act(() => rec.onend())
    expect(rec.abort).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
  it('cancels and ignores stale callbacks, cleans up when scanner opens', () => {
    const { onPick } = setup()
    const old = rec.onresult
    fireEvent.click(screen.getByRole('button', { name: 'Остановить запись' }))
    act(() => old({ results: [Object.assign([{ transcript: 'жим' }], { isFinal: true })] }))
    expect(screen.queryByText('Распознано')).not.toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сканировать название' }))
    expect(rec.abort).toHaveBeenCalledOnce()
    expect(rec.onresult).toBeNull()
  })
  it('times out and aborts on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = setup()
    act(() => vi.advanceTimersByTime(60000))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(rec.abort).not.toHaveBeenCalled()
    act(() => rec.onaudiostart())
    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByRole('alert')).toHaveTextContent('Время записи')
    expect(screen.getByRole('button', { name: 'закрыть' })).toBeEnabled()
    fireEvent.change(screen.getByPlaceholderText('Поиск по названию…'), { target: { value: 'жим' } })
    expect(screen.getByPlaceholderText('Поиск по названию…')).toHaveValue('жим')
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    unmount()
    expect(rec.abort).toHaveBeenCalledOnce()
  })
  it('picks the alternative that matches the catalog and drops the set tail', () => {
    const { onPick } = setup()
    expect(rec.maxAlternatives).toBe(3)
    act(() => rec.onresult({ results: [Object.assign([{ transcript: 'чай с лимоном' }, { transcript: 'жим лежа 60 на 12' }], { isFinal: true })] }))
    expect(screen.getByText('«жим лежа 60 на 12»')).toBeInTheDocument()
    expect(screen.getByText(/Вес и повторы здесь не записываются/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить: Жим лежа' }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(catalog[0])
  })
  it('moves the phrase into the search field', () => {
    setup()
    act(() => rec.onresult({ results: [Object.assign([{ transcript: 'Добавь абракадабру' }], { isFinal: true })] }))
    expect(screen.getByText(/Ничего не найдено/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Искать «абракадабру» в списке' }))
    expect(screen.getByPlaceholderText('Поиск по названию…')).toHaveValue('абракадабру')
    expect(screen.queryByText('Распознано')).not.toBeInTheDocument()
  })
  it('shows at most six candidates', () => {
    vi.stubGlobal('SpeechRecognition', class {
      constructor() { rec = this }
      start = vi.fn()
      abort = vi.fn()
    })
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `j${i}`, name: `Жим вариант ${i + 1}` }))
    render(<ExercisePicker exercises={many} onPick={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Назвать упражнение' }))
    act(() => rec.onresult({ results: [Object.assign([{ transcript: 'жим' }], { isFinal: true })] }))
    expect(screen.getAllByRole('button', { name: /^Добавить: / })).toHaveLength(6)
  })
  it('keeps manual search usable without speech support', () => {
    render(<ExercisePicker exercises={catalog} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Назвать упражнение' })).toBeDisabled()
    expect(screen.getByPlaceholderText('Поиск по названию…')).toBeEnabled()
  })
})
