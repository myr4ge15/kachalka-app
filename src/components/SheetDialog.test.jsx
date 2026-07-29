// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SheetDialog from './SheetDialog.jsx'

describe('SheetDialog', () => {
  it('даёт листу modal-семантику и закрывается по Escape', () => {
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
})
