// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { hasMoreBelow, useScrollMore, MORE_THRESHOLD } from './useScrollMore.js'

describe('hasMoreBelow', () => {
  it('контент ниже видимой части — есть еще; хвост меньше порога — дочитано', () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 500, scrollHeight: 900 })).toBe(true)
    expect(hasMoreBelow({ scrollTop: 400, clientHeight: 500, scrollHeight: 900 })).toBe(false)
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 + MORE_THRESHOLD })).toBe(false)
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 500, scrollHeight: 501 + MORE_THRESHOLD })).toBe(true)
    expect(hasMoreBelow()).toBe(false)
  })
})

function Probe() {
  const ref = useRef(null)
  const { more, scrollMore } = useScrollMore(ref, 'k')
  return (
    <>
      <div ref={ref} data-testid="box"><p>текст</p></div>
      {more && <button onClick={scrollMore}>ещё</button>}
    </>
  )
}

function size(el, { top, client, height }) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: client })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height })
  el.scrollTop = top
}

describe('useScrollMore', () => {
  it('кнопка видна, пока есть хвост, и прячется в конце; «ещё» прокручивает вниз', () => {
    const { rerender } = render(<Probe />)
    const box = screen.getByTestId('box')
    size(box, { top: 0, client: 300, height: 900 })
    act(() => { fireEvent.scroll(box) })
    const btn = screen.getByRole('button', { name: 'ещё' })
    box.scrollTo = undefined // jsdom: прокрутка присвоением
    fireEvent.click(btn)
    expect(box.scrollTop).toBe(198) // 300 × 0.66
    size(box, { top: 600, client: 300, height: 900 })
    act(() => { fireEvent.scroll(box) })
    rerender(<Probe />)
    expect(screen.queryByRole('button', { name: 'ещё' })).toBeNull()
  })
})
