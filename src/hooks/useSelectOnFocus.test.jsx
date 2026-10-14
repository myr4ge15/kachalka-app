// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useSelectOnFocus } from './useSelectOnFocus.js'
import TimeInput from '../components/ui/TimeInput.jsx'

function Field(props) {
  const select = useSelectOnFocus(props)
  return <input aria-label="Вес" defaultValue="82.5" {...select} />
}

afterEach(() => vi.useRealTimers())

describe('useSelectOnFocus — тап по полю подхода выделяет значение целиком', () => {
  it('фокус выделяет все число', () => {
    render(<Field />)
    const el = screen.getByLabelText('Вес')
    act(() => el.focus())
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4])
  })

  it('mouseup того же тапа не переставляет каретку, следующий тап — как обычно', () => {
    render(<Field />)
    const el = screen.getByLabelText('Вес')
    act(() => el.focus())
    const first = fireEvent.mouseUp(el) // false = preventDefault
    expect(first).toBe(false)
    expect(fireEvent.mouseUp(el)).toBe(true)
  })

  it('повторный фокус после blur снова выделяет; свой onFocus зовется', () => {
    const onFocus = vi.fn()
    render(<Field onFocus={onFocus} />)
    const el = screen.getByLabelText('Вес')
    act(() => el.focus())
    act(() => el.blur())
    el.setSelectionRange(1, 1)
    act(() => el.focus())
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4])
    expect(onFocus).toHaveBeenCalledTimes(2)
  })

  it('TimeInput: выделение после того, как значение стало «мм:сс»', () => {
    vi.useFakeTimers()
    render(<TimeInput aria-label="Время" value={90} onChange={() => {}} />)
    const el = screen.getByLabelText('Время')
    act(() => el.focus())
    act(() => vi.runAllTimers())
    expect(el.value).toBe('1:30')
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4])
  })
})
