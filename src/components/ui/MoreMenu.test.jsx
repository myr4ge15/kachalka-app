// @vitest-environment jsdom
// Меню «⋯» (ui/MoreMenu): кнопка открывает, первый пункт в фокусе, тап мимо и Esc закрывают.
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MoreMenu from './MoreMenu.jsx'

function WithButton({ two = false }) {
  const [open, setOpen] = useState(false)
  return (
    <MoreMenu label="Действия" open={open} onToggle={() => setOpen((v) => !v)} onClose={() => setOpen(false)}>
      {two && <button type="button" role="menuitem">Изменить</button>}
      <button type="button" role="menuitem">Удалить</button>
    </MoreMenu>
  )
}

describe('MoreMenu', () => {
  it('кнопка «⋯» открывает, первый пункт в фокусе; тап мимо — закрыть', () => {
    render(<WithButton />)
    const btn = screen.getByRole('button', { name: 'Действия' })
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Esc закрывает и возвращает фокус на «⋯»', () => {
    render(<WithButton />)
    const btn = screen.getByRole('button', { name: 'Действия' })
    fireEvent.click(btn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn).toHaveFocus()
  })

  it('стрелки ходят по пунктам по кругу, Tab закрывает (UI-ревью 23.10)', () => {
    render(<WithButton two />)
    fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
    expect(screen.getByRole('menuitem', { name: 'Изменить' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Изменить' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
