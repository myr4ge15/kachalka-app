// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import SheetDialog from './SheetDialog.jsx'

// Свайп листа включается только на iOS «на экране Домой» — в jsdom подменяем проверку.
const swipeEnv = vi.hoisted(() => ({ on: false }))
vi.mock('../../hooks/useEdgeSwipeBack.js', async (orig) => ({ ...(await orig()), edgeSwipeAvailable: () => swipeEnv.on }))
afterEach(() => { swipeEnv.on = false; vi.useRealTimers() })

// Жест пальцем: старт, движения, отпускание. Возвращает, гасился ли последний touchmove.
function drag(target, [x0, y0], ...points) {
  const fire = (type, x, y) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    event.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }]
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  fire('touchstart', x0, y0)
  let prevented = false
  for (const [x, y] of points) prevented = fire('touchmove', x, y)
  fire('touchend')
  return prevented
}

describe('SheetDialog', () => {
  it('пропускает свайпы чипов с дрожанием по Y, но блокирует края и фон', () => {
    render(<SheetDialog title="Чипы" onDismiss={() => {}}>
      <div data-testid="chips" style={{ overflowX: 'auto', overflowY: 'hidden' }}><button>Грудь</button></div>
    </SheetDialog>)
    const chips = screen.getByTestId('chips')
    Object.defineProperties(chips, {
      scrollWidth: { value: 900 }, clientWidth: { value: 300 },
    })
    const chip = screen.getByRole('button', { name: 'Грудь' })
    const touch = (type, x, y, target = chip) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      event.touches = [{ clientX: x, clientY: y }]
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    touch('touchstart', 200, 100)
    expect(touch('touchmove', 160, 103)).toBe(false)
    chips.scrollLeft = 40
    expect(touch('touchmove', 159, 110)).toBe(false) // ось не меняется от дрожания
    touch('touchstart', 160, 100)
    expect(touch('touchmove', 200, 98)).toBe(false) // обратно
    chips.scrollLeft = 0
    touch('touchstart', 160, 100)
    expect(touch('touchmove', 200, 102)).toBe(true)
    chips.scrollLeft = 600
    touch('touchstart', 200, 100)
    expect(touch('touchmove', 160, 102)).toBe(true)
    const head = screen.getByText('Чипы')
    touch('touchstart', 200, 100, head)
    expect(touch('touchmove', 160, 102, head)).toBe(true)
  })

  it('дает листу modal-семантику и закрывается по Escape', () => {
    const onDismiss = vi.fn()
    render(
      <SheetDialog title="Выбрать упражнение" onDismiss={onDismiss}>
        <button>Первый</button>
      </SheetDialog>
    )

    const dialog = screen.getByRole('dialog', { name: 'Выбрать упражнение' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('не фокусирует повторно уже активное autoFocus-поле', () => {
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus')
    try {
      render(
        <SheetDialog title="Поиск" onDismiss={() => {}}>
          <input data-autofocus autoFocus aria-label="Найти" />
        </SheetDialog>
      )

      expect(screen.getByRole('textbox', { name: 'Найти' })).toHaveFocus()
      expect(focus).toHaveBeenCalledOnce()
    } finally {
      focus.mockRestore()
    }
  })

  it('удерживает Tab внутри и возвращает фокус на кнопку-источник', () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть</button>
          {open && (
            <SheetDialog title="Лист" onDismiss={() => setOpen(false)}>
              <button data-autofocus>Первый</button>
              <button>Последний</button>
            </SheetDialog>
          )}
        </>
      )
    }

    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Открыть' })
    opener.focus()
    fireEvent.click(opener)
    const close = screen.getByRole('button', { name: 'закрыть' })
    const first = screen.getByRole('button', { name: 'Первый' })
    const last = screen.getByRole('button', { name: 'Последний' })
    expect(first).toHaveFocus()

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(first, { key: 'Escape' })
    expect(opener).toHaveFocus()
  })

  // РЕВЬЮ-КОДА-2026-10-02: Escape работает и без фокуса внутри листа, фон — inert.
  it('Escape закрывает лист, даже когда фокус вне листа', () => {
    const onDismiss = vi.fn()
    render(
      <SheetDialog title="Лист" onDismiss={onDismiss}>
        <button>Первый</button>
      </SheetDialog>
    )
    document.body.focus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('Escape закрывает только верхний из двух листов', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <SheetDialog title="Внешний" onDismiss={outer}><button>A</button></SheetDialog>
        <SheetDialog title="Внутренний" onDismiss={inner}><button>B</button></SheetDialog>
      </>
    )
    // Верхний лист живой, нижний — под ним и заморожен вместе с фоном.
    expect(screen.getByRole('dialog', { name: 'Внутренний' }).closest('[inert]')).toBeNull()
    expect(screen.getByText('A').closest('[inert]')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledOnce()
    expect(outer).not.toHaveBeenCalled()
  })

  it('делает фон inert на время листа и снимает пометку при закрытии', () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть</button>
          {open && (
            <SheetDialog title="Лист" onDismiss={() => setOpen(false)}>
              <button>Внутри</button>
            </SheetDialog>
          )}
        </>
      )
    }
    const { container } = render(<Host />)
    const opener = screen.getByRole('button', { name: 'Открыть' })
    opener.focus()
    fireEvent.click(opener)
    expect(container).toHaveAttribute('inert')
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container).not.toHaveAttribute('inert')
    expect(opener).toHaveFocus()
  })
  it('пока открыт хоть один лист, фон не прокручивается (data-sheet-open)', () => {
    const root = document.documentElement
    const { rerender, unmount } = render(
      <>
        <SheetDialog title="Нижний" onDismiss={() => {}}><button>a</button></SheetDialog>
        <SheetDialog title="Верхний" onDismiss={() => {}}><button>b</button></SheetDialog>
      </>
    )
    expect(root.dataset.sheetOpen).toBe('1')
    rerender(<SheetDialog title="Нижний" onDismiss={() => {}}><button>a</button></SheetDialog>)
    expect(root.dataset.sheetOpen).toBe('1') // нижний еще открыт
    unmount()
    expect(root.dataset.sheetOpen).toBeUndefined()
  })

  it('жест по затемнению гасится, внутри листа — нет', () => {
    render(<SheetDialog title="Лист" onDismiss={() => {}}><div data-testid="inside">x</div></SheetDialog>)
    const overlay = document.querySelector('.overlay')
    const onBackdrop = new Event('touchmove', { bubbles: true, cancelable: true })
    overlay.dispatchEvent(onBackdrop)
    expect(onBackdrop.defaultPrevented).toBe(true)
    const inside = new Event('touchmove', { bubbles: true, cancelable: true })
    screen.getByTestId('inside').dispatchEvent(inside)
    expect(inside.defaultPrevented).toBe(false)
  })

  // v6.15.1: жест по короткому листу (прокручивать нечего) тянул на iPhone всю страницу.
  it('жест внутри листа гасится, если прокручивать нечего; в прокручиваемом списке — проходит', () => {
    render(
      <SheetDialog title="Лист" onDismiss={() => {}}>
        <div data-testid="short">коротко</div>
        <div data-testid="list" style={{ overflowY: 'auto' }}><span data-testid="row">строка</span></div>
      </SheetDialog>
    )
    const swipe = (el, from, to) => {
      const start = new Event('touchstart', { bubbles: true })
      start.touches = [{ clientY: from }]
      el.dispatchEvent(start)
      const move = new Event('touchmove', { bubbles: true, cancelable: true })
      move.touches = [{ clientY: to }]
      el.dispatchEvent(move)
      return move.defaultPrevented
    }
    expect(swipe(screen.getByTestId('short'), 300, 360)).toBe(true)
    const list = screen.getByTestId('list')
    Object.defineProperty(list, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true })
    list.scrollTop = 100
    expect(swipe(screen.getByTestId('row'), 300, 360)).toBe(false) // есть куда вверх
    list.scrollTop = 0
    expect(swipe(screen.getByTestId('row'), 300, 360)).toBe(true) // уперлись в начало
    expect(swipe(screen.getByTestId('row'), 360, 300)).toBe(false) // а вниз — можно
  })
})

// v8.1.1 (обращение fb_9be302c1): лист во весь экран закрывается свайпом вправо, как экран.
describe('SheetDialog swipeBack', () => {
  const sheet = (props = {}) => {
    const onDismiss = vi.fn()
    render(
      <SheetDialog title="Подсказка" onDismiss={onDismiss} swipeBack {...props}>
        <p data-testid="text">текст</p>
        <input aria-label="поле" />
      </SheetDialog>
    )
    return onDismiss
  }

  it('свайп вправо уводит лист и закрывает его', () => {
    swipeEnv.on = true
    vi.useFakeTimers()
    const onDismiss = sheet()
    const prevented = drag(screen.getByTestId('text'), [100, 300], [140, 302], [260, 305])
    expect(prevented).toBe(true) // жест наш — страница не прокручивается
    expect(screen.getByRole('dialog').style.transform).toMatch(/translateX/)
    expect(onDismiss).not.toHaveBeenCalled() // сначала доезжает
    act(() => { vi.advanceTimersByTime(200) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('короткий свайп возвращает лист; вертикальный — прокрутка; поле — свое', () => {
    swipeEnv.on = true
    vi.useFakeTimers()
    const onDismiss = sheet()
    drag(screen.getByTestId('text'), [100, 300], [112, 300], [125, 300])
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('dialog').style.transform).toBe('')
    drag(screen.getByTestId('text'), [100, 300], [110, 360], [200, 500])
    drag(screen.getByRole('textbox', { name: 'поле' }), [100, 300], [160, 300], [300, 300])
    act(() => { vi.advanceTimersByTime(200) })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('без поддержки устройства (не iOS-PWA) свайп не закрывает', () => {
    vi.useFakeTimers()
    const off = sheet() // jsdom: не iOS-PWA
    drag(screen.getByTestId('text'), [100, 300], [140, 300], [300, 300])
    act(() => { vi.advanceTimersByTime(200) })
    expect(off).not.toHaveBeenCalled()
  })

  it('dismissDisabled выключает жест', () => {
    swipeEnv.on = true
    vi.useFakeTimers()
    const onDismiss = sheet({ dismissDisabled: true })
    drag(screen.getByTestId('text'), [100, 300], [140, 300], [300, 300])
    act(() => { vi.advanceTimersByTime(200) })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
