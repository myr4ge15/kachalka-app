// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ScrollTopButton from './ScrollTopButton.jsx'

describe('ScrollTopButton', () => {
  it('появляется после прокрутки .content и возвращает ее наверх', () => {
    render(<div className="content"><div className="screen"><ScrollTopButton /></div></div>)
    const sc = document.querySelector('.content')
    sc.scrollTo = vi.fn()
    expect(screen.queryByRole('button', { name: 'Наверх' })).toBeNull()
    act(() => { sc.scrollTop = 800; sc.dispatchEvent(new Event('scroll')) })
    fireEvent.click(screen.getByRole('button', { name: 'Наверх' }))
    expect(sc.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    act(() => { sc.scrollTop = 100; sc.dispatchEvent(new Event('scroll')) })
    expect(screen.queryByRole('button', { name: 'Наверх' })).toBeNull()
  })
})
