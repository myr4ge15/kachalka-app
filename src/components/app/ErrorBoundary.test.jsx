// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import ErrorBoundary from './ErrorBoundary.jsx'

let shouldThrow
function Bomb() {
  if (shouldThrow) throw new Error('бах')
  return <p>экран</p>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true
    // React и сам боундари пишут в console.error — в выводе тестов это шум.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('без ошибки — просто дети', () => {
    shouldThrow = false
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText('экран')).toBeInTheDocument()
  })

  it('корневой режим: экран «Что-то пошло не так» с перезагрузкой, ошибка логируется', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Что-то пошло не так' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Перезагрузить' }))
    expect(reload).toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('Перехвачено ErrorBoundary:', expect.any(Error), expect.anything())
  })

  it('пер-экранный режим: fallback(error, reset); reset рисует детей заново', () => {
    render(
      <ErrorBoundary fallback={(err, reset) => (
        <button onClick={() => { shouldThrow = false; reset() }}>Повторить: {err.message}</button>
      )}>
        <Bomb />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Повторить: бах' }))
    expect(screen.getByText('экран')).toBeInTheDocument()
  })

  it('fallback-узел (не функция) рисуется как есть', () => {
    render(<ErrorBoundary fallback={<p>упало</p>}><Bomb /></ErrorBoundary>)
    expect(screen.getByText('упало')).toBeInTheDocument()
  })

  it('ошибка одного экрана не роняет соседей вне боундари', () => {
    function Shell() {
      const [n] = useState(0)
      return <><header>шапка {n}</header><ErrorBoundary fallback={<p>упало</p>}><Bomb /></ErrorBoundary></>
    }
    render(<Shell />)
    expect(screen.getByText('шапка 0')).toBeInTheDocument()
  })
})
