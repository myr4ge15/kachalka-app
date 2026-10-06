// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SheetDialog from './SheetDialog.jsx'

describe('SheetDialog', () => {
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
