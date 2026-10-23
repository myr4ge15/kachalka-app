// @vitest-environment jsdom
// Экран внутри экрана (23.10.2026): исходный остается смонтированным (состояние живо), скрыт и недоступен,
// пока сверху открыт другой; открытие — с верха, возврат — на прежнее место; свайп «назад» — onBack.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import NavLayers from './NavLayers.jsx'

function Harness({ swipe = false, onBack: spy = () => {} }) {
  const box = useRef(null)
  const [open, setOpen] = useState(false)
  const [n, setN] = useState(0)
  return (
    <main data-testid="box" ref={box}>
      <NavLayers open={open} onBack={() => { spy(); setOpen(false) }} contentRef={box} swipe={swipe}
        under={<div><button onClick={() => setN((x) => x + 1)}>счет {n}</button><button onClick={() => setOpen(true)}>открыть</button></div>}>
        <p>верхний экран</p>
      </NavLayers>
    </main>
  )
}

describe('NavLayers', () => {
  it('исходный экран не размонтируется: состояние цело после возврата; пока открыт верхний — скрыт', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'счет 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }))
    expect(screen.getByText('верхний экран').closest('.nav-layer')).toHaveClass('nav-current', 'screen-anim--push')
    expect(screen.queryByRole('button', { name: 'счет 1' })).toBeNull() // aria-hidden + inert
    expect(document.querySelector('.nav-underlay')).toHaveAttribute('aria-hidden', 'true')
  })

  it('прокрутка: открытие — с верха, возврат — на место списка', () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1 })
    const { getByTestId } = render(<Harness swipe />)
    const box = getByTestId('box')
    box.scrollTop = 240
    fireEvent.scroll(box)
    expect(document.querySelector('.nav-current').dataset.scrollTop).toBe('240')
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }))
    expect(box.scrollTop).toBe(0)
    fireEvent.click(document.body) // ничего не закрывает
    expect(screen.getByText('верхний экран')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('свайп назад с верхнего экрана — onBack', () => {
    vi.useFakeTimers()
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness swipe onBack={onBack} />)
    const box = getByTestId('box')
    Object.defineProperty(box, 'clientWidth', { value: 390 })
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }))
    const pt = (x) => ({ touches: [{ clientX: x, clientY: 300 }] })
    fireEvent.touchStart(box, pt(10))
    fireEvent.touchMove(box, pt(40))
    fireEvent.touchMove(box, pt(260))
    fireEvent.touchEnd(box, { touches: [] })
    vi.advanceTimersByTime(400)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('верхний экран')).toBeNull()
    vi.useRealTimers()
  })
})
