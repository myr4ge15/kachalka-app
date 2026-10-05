// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { useTabDot } from './useTabDot.js'

const rect = (left, width) => ({ left, width, top: 0, right: left + width, bottom: 40, height: 40 })

function Nav({ active, tabs = ['home', 'history'] }) {
  const ref = useRef(null)
  useTabDot(ref, active)
  return (
    <nav ref={ref} data-testid="nav">
      {tabs.map((k, i) => (
        <button key={k} className={k === active ? 'tab active' : 'tab'} data-left={100 * i} />
      ))}
    </nav>
  )
}

describe('useTabDot', () => {
  let observers
  let rafs
  beforeEach(() => {
    observers = []
    rafs = []
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return this.tagName === 'NAV' ? rect(10, 400) : rect(10 + Number(this.dataset.left || 0), 100)
    })
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
      observe() {}
    }
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafs.push(cb); return rafs.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete globalThis.ResizeObserver
  })

  it('ставит --dot-x под центр активной вкладки и включает анимацию только после первой расстановки', () => {
    const { getByTestId } = render(<Nav active="home" />)
    const nav = getByTestId('nav')
    expect(nav.style.getPropertyValue('--dot-x')).toBe('48px') // 0 + 100/2 − 4/2
    expect(nav.dataset.dot).toBe('on')
    expect(nav.dataset.dotReady).toBeUndefined()
    act(() => rafs.forEach((cb) => cb()))
    expect(nav.dataset.dotReady).toBe('1')
  })

  it('переезжает при смене вкладки; на вложенном роуте (нет активной) гаснет', () => {
    const { getByTestId, rerender } = render(<Nav active="home" />)
    rerender(<Nav active="history" />)
    expect(getByTestId('nav').style.getPropertyValue('--dot-x')).toBe('148px')
    rerender(<Nav active="notif" />)
    expect(getByTestId('nav').dataset.dot).toBe('off')
  })

  it('пересчитывает при ресайзе меню и отписывается при размонтировании', () => {
    const { getByTestId, unmount } = render(<Nav active="history" />)
    const nav = getByTestId('nav')
    nav.querySelectorAll('.tab')[1].dataset.left = '200'
    act(() => observers.at(-1).cb())
    expect(nav.style.getPropertyValue('--dot-x')).toBe('248px')
    const ro = observers.at(-1)
    unmount()
    expect(ro.disconnect).toHaveBeenCalled()
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('без ResizeObserver/rAF (старые браузеры) работает', () => {
    delete globalThis.ResizeObserver
    vi.stubGlobal('requestAnimationFrame', undefined)
    const { getByTestId, unmount } = render(<Nav active="home" />)
    expect(getByTestId('nav').dataset.dot).toBe('on')
    expect(() => unmount()).not.toThrow()
  })
})
