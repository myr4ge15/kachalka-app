// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useRevealFocus } from './useRevealFocus.js'

function Probe({ trigger, block }) {
  const ref = useRevealFocus(trigger, block ? { block } : undefined)
  return <div ref={ref} data-testid="target" />
}

describe('useRevealFocus', () => {
  let scroll
  let reduced
  beforeEach(() => {
    reduced = false
    scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    window.matchMedia = vi.fn(() => ({ matches: reduced }))
  })
  afterEach(() => {
    delete Element.prototype.scrollIntoView
    delete window.matchMedia
  })

  it('начальная загрузка и закрытие (пустой trigger) экран не двигают', () => {
    const { rerender } = render(<Probe trigger={null} />)
    rerender(<Probe trigger="" />)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('центрирует элемент плавно на смену trigger', () => {
    render(<Probe trigger="a" />)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  })

  it('reveal — только на ФАКТИЧЕСКУЮ смену: перерисовка с тем же trigger не прокручивает', () => {
    const { rerender } = render(<Probe trigger="a" />)
    rerender(<Probe trigger="a" />)
    rerender(<Probe trigger="a" />)
    expect(scroll).toHaveBeenCalledTimes(1)
    rerender(<Probe trigger="b" />)
    expect(scroll).toHaveBeenCalledTimes(2)
    rerender(<Probe trigger={null} />) // закрытие — без прыжка
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  it('prefers-reduced-motion → мгновенно; block можно переопределить', () => {
    reduced = true
    render(<Probe trigger="a" block="start" />)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start', inline: 'nearest' })
  })

  it('нет matchMedia или scrollIntoView — не падает', () => {
    delete window.matchMedia
    expect(() => render(<Probe trigger="a" />)).not.toThrow()
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    delete Element.prototype.scrollIntoView
    expect(() => render(<Probe trigger="b" />)).not.toThrow()
  })
})
