// @vitest-environment jsdom
// Меню комментария по удержанию (fb_830c22d6): копия пузыря на его месте, меню под ним,
// у нижнего края группа уезжает вверх; пункты, тап мимо, Esc (не доходит до листа) и возврат фокуса.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CommentMenu, { MENU_GAP, MENU_PAD } from './CommentMenu.jsx'

function makeAnchor(rect) {
  const sheet = document.createElement('div')
  sheet.className = 'sheet'
  sheet.getBoundingClientRect = () => ({ top: 0, left: 0, right: 400, bottom: 800, width: 400, height: 800 })
  const el = document.createElement('div')
  el.className = 'cm-bub held'
  el.tabIndex = 0
  el.setAttribute('aria-haspopup', 'menu')
  el.textContent = 'Мощно!'
  el.getBoundingClientRect = () => ({ top: rect.top, left: rect.left, right: rect.left + 200, bottom: rect.top + 40, width: 200, height: 40 })
  sheet.append(el)
  document.body.append(sheet)
  return { sheet, el }
}

// Сначала размонтировать (портал живет в листе), потом убрать наши узлы.
afterEach(() => { cleanup(); document.body.innerHTML = '' })

const actions = (fns = {}) => [
  { key: 'reply', icon: 'reply', label: 'Ответить', onSelect: fns.reply },
  { key: 'edit', icon: 'edit', label: 'Изменить', disabled: true },
  { key: 'delete', icon: 'delete', label: 'Удалить', danger: true, onSelect: fns.del },
]

describe('CommentMenu', () => {
  it('в листе: копия пузыря на его месте (слева), меню с пунктами, первый в фокусе', () => {
    const { sheet, el } = makeAnchor({ top: 100, left: 48 })
    const reply = vi.fn()
    render(<CommentMenu anchor={el} itemClass="cm-item last" actions={actions({ reply })} onClose={vi.fn()} />)
    const layer = sheet.querySelector('.cmm')
    expect(layer).not.toBeNull()
    expect(layer).not.toHaveClass('fixed')
    const group = layer.querySelector('.cmm-group')
    expect(group).toHaveClass('left')
    expect(group.style.top).toBe('100px')
    expect(group.style.left).toBe('48px')
    const copy = layer.querySelector('.cmm-bubble.cm-item.last .cm-bub')
    expect(copy).toHaveAttribute('aria-hidden', 'true')
    expect(copy).not.toHaveAttribute('tabindex')
    expect(copy).not.toHaveClass('held') // копия видна, хотя оригинал спрятан
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Ответить', 'Изменить', 'Удалить'])
    expect(screen.getByRole('menuitem', { name: 'Изменить' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveClass('danger')
    expect(screen.getByRole('menuitem', { name: 'Ответить' })).toHaveFocus()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ответить' }))
    expect(reply).toHaveBeenCalled()
  })

  it('свой — прижат вправо; у нижнего края группа уезжает вверх, чтобы меню влезло', () => {
    const { sheet, el } = makeAnchor({ top: 760, left: 150 })
    const menuH = 150
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(menuH)
    render(<CommentMenu anchor={el} align="right" actions={actions()} onClose={vi.fn()} />)
    spy.mockRestore()
    const group = sheet.querySelector('.cmm-group')
    expect(group).toHaveClass('right')
    expect(group.style.right).toBe('50px')
    expect(group.style.top).toBe(`${800 - MENU_PAD - menuH - MENU_GAP - 40}px`)
  })

  it('тап мимо меню — закрыть, по меню — нет; Esc закрывает, до листа не доходит, фокус — на пузырь', () => {
    const { sheet, el } = makeAnchor({ top: 100, left: 48 })
    const onClose = vi.fn()
    const { unmount } = render(<CommentMenu anchor={el} actions={actions()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menu'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(sheet.querySelector('.cmm-scrim'))
    expect(onClose).toHaveBeenCalledTimes(1)
    const sheetEsc = vi.fn()
    document.addEventListener('keydown', sheetEsc)
    fireEvent.keyDown(document, { key: 'Escape' })
    document.removeEventListener('keydown', sheetEsc)
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(sheetEsc).not.toHaveBeenCalled()
    unmount()
    expect(el).toHaveFocus()
  })

  it('с реакциями: полоска над пузырем, пузырь на своем месте; выбранная подсвечена; тап по полоске меню не закрывает', () => {
    const { sheet, el } = makeAnchor({ top: 300, left: 48 })
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(52)
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<CommentMenu anchor={el} actions={actions()} reactions={{ mine: 'fire', onPick }} onClose={onClose} />)
    spy.mockRestore()
    const group = sheet.querySelector('.cmm-group')
    expect(group.style.top).toBe(`${300 - 52 - MENU_GAP}px`)
    expect(group.firstElementChild).toHaveClass('cmm-reacts')
    expect(screen.getByRole('button', { name: 'Огонь' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Смешно' }))
    expect(onPick).toHaveBeenCalledWith('laugh')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('без листа — слой на весь экран', () => {
    const el = document.createElement('div')
    document.body.append(el)
    render(<CommentMenu anchor={el} actions={actions()} onClose={vi.fn()} />)
    expect(document.querySelector('.cmm')).toHaveClass('fixed')
  })
})
