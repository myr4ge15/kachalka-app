// @vitest-environment jsdom
import { useState } from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSortable } from './useSortable.js'

// jsdom не считает раскладку: строки по 90px с зазором 10px (top = i * 100).
function layout(container) {
  container.querySelectorAll('[data-id]').forEach(el => {
    el.getBoundingClientRect = () => {
      const i = [...el.parentNode.children].indexOf(el)
      return { top: i * 100, height: 90, bottom: i * 100 + 90 }
    }
  })
}
function Harness({ onMove, onLift, onDrop, holdMs, ids = ['a', 'b', 'c'] }) {
  const [order, setOrder] = useState(ids)
  const ref = useSortable((id, beforeId) => {
    onMove(id, beforeId)
    setOrder(prev => {
      const rest = prev.filter(x => x !== id)
      rest.splice(beforeId === null ? rest.length : rest.indexOf(beforeId), 0, id)
      return rest
    })
  }, { attr: 'data-id', handle: '.grip', holdMs, onLift, onDrop })
  return <div ref={ref}>{order.map(id => <div key={id} data-id={id}>
    <button className="grip">{id}</button><input aria-label={id} />
  </div>)}</div>
}
function setup(props = {}) {
  const onMove = vi.fn(), onLift = vi.fn(), onDrop = vi.fn()
  const r = render(<Harness onMove={onMove} onLift={onLift} onDrop={onDrop} holdMs={350} {...props} />)
  layout(r.container)
  const row = id => r.container.querySelector(`[data-id="${id}"]`)
  const grip = id => row(id).querySelector('.grip')
  const order = () => [...r.container.querySelectorAll('[data-id]')].map(el => el.dataset.id)
  return { ...r, onMove, onLift, onDrop, row, grip, order }
}
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] })
const mouse = (target, type, clientY) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 })
  Object.defineProperty(e, 'pointerType', { value: 'mouse' })
  fireEvent(target, e)
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useSortable — удержание (тренировка)', () => {
  it('строка поднимается, едет за пальцем, соседи расступаются; порядок — только после приземления', () => {
    const { grip, row, onMove, onLift, onDrop, order } = setup()
    fireEvent.touchStart(grip('c'), touch(20, 245))
    expect(row('c')).not.toHaveClass('sort-lifted')
    act(() => vi.advanceTimersByTime(350))
    expect(onLift).toHaveBeenCalledWith('c')
    expect(row('c')).toHaveClass('sort-lifted')
    expect(row('a')).toHaveClass('sort-shift')
    fireEvent.touchMove(grip('c'), touch(20, 25)) // палец наверху списка
    expect(row('c').style.transform).toBe('translate3d(0, -200px, 0)')
    // место открывается сверху: a и b уехали вниз на высоту строки + зазор
    expect(row('a').style.transform).toBe('translate3d(0, 100px, 0)')
    expect(row('b').style.transform).toBe('translate3d(0, 100px, 0)')
    fireEvent.touchEnd(grip('c'))
    expect(row('c')).toHaveClass('sort-dropping')
    expect(onMove).not.toHaveBeenCalled() // еще доезжает
    act(() => vi.advanceTimersByTime(180))
    expect(onMove).toHaveBeenCalledWith('c', 'a')
    expect(onDrop).toHaveBeenCalledOnce()
    expect(order()).toEqual(['c', 'a', 'b'])
    for (const id of ['a', 'b', 'c']) {
      expect(row(id).style.transform).toBe('')
      expect(row(id).className).toBe('')
    }
  })

  it('вниз: перед строкой ниже и в самый конец; строка не вылетает за край списка', () => {
    const { grip, row, onMove } = setup()
    fireEvent.touchStart(grip('a'), touch(20, 45))
    act(() => vi.advanceTimersByTime(350))
    fireEvent.touchMove(grip('a'), touch(20, 600)) // ниже последней
    expect(row('a').style.transform).toBe('translate3d(0, 200px, 0)')
    expect(row('b').style.transform).toBe('translate3d(0, -100px, 0)')
    fireEvent.touchEnd(grip('a'))
    act(() => vi.advanceTimersByTime(180))
    expect(onMove).toHaveBeenLastCalledWith('a', null)
  })

  it('свайп до удержания, отмена касания и второй палец порядок не меняют; строка возвращается', () => {
    const { grip, row, onMove, onDrop } = setup()
    fireEvent.touchStart(grip('c'), touch(20, 245))
    fireEvent.touchMove(grip('c'), touch(20, 225)) // скролл: > 8px до удержания
    act(() => vi.advanceTimersByTime(400))
    expect(row('c')).not.toHaveClass('sort-lifted')
    fireEvent.touchEnd(grip('c'))

    fireEvent.touchStart(grip('c'), touch(20, 245))
    act(() => vi.advanceTimersByTime(350))
    fireEvent.touchMove(grip('c'), touch(20, 25))
    fireEvent.touchCancel(grip('c'))
    expect(row('c').style.transform).toBe('translate3d(0, 0px, 0)') // едет на место
    expect(row('a').style.transform).toBe('')
    act(() => vi.advanceTimersByTime(180))

    fireEvent.touchStart(grip('c'), touch(20, 245))
    act(() => vi.advanceTimersByTime(350))
    fireEvent.touchMove(grip('c'), { touches: [{ clientX: 20, clientY: 10 }, { clientX: 40, clientY: 10 }] })
    act(() => vi.advanceTimersByTime(180))
    fireEvent.touchEnd(grip('c'))
    act(() => vi.advanceTimersByTime(180))
    expect(onMove).not.toHaveBeenCalled()
    expect(onDrop).toHaveBeenCalledTimes(2)
  })

  it('отпустил на старом месте — без onMove; поле ввода жест не начинает; размонтирование гасит удержание', () => {
    const { container, grip, onMove, unmount } = setup()
    fireEvent.touchStart(grip('b'), touch(20, 145))
    act(() => vi.advanceTimersByTime(350))
    fireEvent.touchMove(grip('b'), touch(20, 150))
    fireEvent.touchEnd(grip('b'))
    act(() => vi.advanceTimersByTime(180))
    fireEvent.touchStart(container.querySelector('input'), touch(20, 45))
    act(() => vi.advanceTimersByTime(400))
    fireEvent.touchEnd(container.querySelector('input'))
    fireEvent.touchStart(grip('a'), touch(20, 45))
    unmount()
    act(() => vi.advanceTimersByTime(400))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('скролл страницы гасит и корень — даже если элемента под пальцем уже нет (iOS, свернутая карточка)', () => {
    const { grip, row } = setup()
    fireEvent.touchStart(grip('c'), touch(20, 245))
    // До подъема скролл свободный: обычный свайп по списку прокручивает страницу.
    expect(fireEvent.touchMove(row('a'), touch(20, 240))).toBe(true)
    fireEvent.touchEnd(grip('c'))
    fireEvent.touchStart(grip('c'), touch(20, 245))
    act(() => vi.advanceTimersByTime(350))
    // После подъема touchmove, всплывший до корня с ЛЮБОГО места списка, отменен.
    expect(fireEvent.touchMove(row('a'), touch(20, 200))).toBe(false)
    fireEvent.touchEnd(grip('c'))
  })

  it('клик сразу после перетаскивания гасится (не раскрывает карточку)', () => {
    const { grip } = setup()
    const onClick = vi.fn()
    grip('c').addEventListener('click', onClick)
    fireEvent.touchStart(grip('c'), touch(20, 245))
    act(() => vi.advanceTimersByTime(350))
    fireEvent.touchMove(grip('c'), touch(20, 25))
    fireEvent.touchEnd(grip('c'))
    fireEvent.click(grip('c'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('useSortable — за ручку (шаблоны, админка)', () => {
  it('тач поднимает сразу, без удержания', () => {
    const { grip, row, onMove } = setup({ holdMs: 0 })
    fireEvent.touchStart(grip('a'), touch(20, 45))
    expect(row('a')).toHaveClass('sort-lifted')
    fireEvent.touchMove(grip('a'), touch(20, 160))
    fireEvent.touchEnd(grip('a'))
    act(() => vi.advanceTimersByTime(180))
    expect(onMove).toHaveBeenCalledWith('a', 'c')
  })

  it('мышь: pointerdown на ручке → движение окна → pointerup', () => {
    const { grip, row, onMove, order } = setup({ holdMs: 0 })
    mouse(grip('c'), 'pointerdown', 245)
    expect(row('c')).toHaveClass('sort-lifted')
    mouse(window, 'pointermove', 140)
    mouse(window, 'pointerup', 140)
    act(() => vi.advanceTimersByTime(180))
    expect(onMove).toHaveBeenCalledWith('c', 'b')
    expect(order()).toEqual(['a', 'c', 'b'])
  })
})

describe('useSortable — клавиатура', () => {
  it('Alt+↑/↓ на ручке — на одну позицию, фокус остается на ручке; поле ввода не перехватывает', () => {
    const { grip, row, onMove, order } = setup()
    grip('b').focus()
    fireEvent.keyDown(grip('b'), { altKey: true, key: 'ArrowUp' })
    expect(onMove).toHaveBeenLastCalledWith('b', 'a')
    expect(order()).toEqual(['b', 'a', 'c'])
    expect(document.activeElement).toBe(grip('b'))
    fireEvent.keyDown(grip('b'), { altKey: true, key: 'ArrowUp' }) // уже первая
    fireEvent.keyDown(row('a').querySelector('input'), { altKey: true, key: 'ArrowDown' })
    fireEvent.keyDown(grip('b'), { key: 'ArrowDown' }) // без Alt
    expect(onMove).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(grip('a'), { altKey: true, key: 'ArrowDown' })
    expect(onMove).toHaveBeenLastCalledWith('a', null)
  })
})

describe('useSortable — корень появляется позже', () => {
  it('callback-ref подключает список, смонтированный после хука', () => {
    function Late({ onMove }) {
      const [open, setOpen] = useState(false)
      const ref = useSortable(onMove, { attr: 'data-id', handle: '.grip' })
      return <>
        <button onClick={() => setOpen(true)}>open</button>
        {open && <div ref={ref}>{['a', 'b'].map(id => <div key={id} data-id={id}><button className="grip">{id}</button></div>)}</div>}
      </>
    }
    const onMove = vi.fn()
    const { container, getByText } = render(<Late onMove={onMove} />)
    fireEvent.click(getByText('open'))
    layout(container)
    const g = container.querySelector('[data-id="b"] .grip')
    fireEvent.keyDown(g, { altKey: true, key: 'ArrowUp' })
    expect(onMove).toHaveBeenCalledWith('b', 'a')
  })
})
