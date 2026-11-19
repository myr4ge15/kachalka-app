// @vitest-environment jsdom
// Аватар крупно (v6.18.0): по центру поверх размытого экрана, закрыть — тап или Escape.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AvatarZoom from './AvatarZoom.jsx'
import { AVATAR_UPLOAD_PX } from '../../lib/avatar.js'

const open = () => fireEvent.click(screen.getByRole('button', { name: /Аватар Маша — открыть крупно/ }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterAll(() => {
  delete HTMLDialogElement.prototype.showModal
  delete HTMLDialogElement.prototype.close
})

describe('AvatarZoom', () => {
  it('без картинки — просто инициал, не кнопка', () => {
    render(<AvatarZoom name="Маша" url={null} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('М')).toBeInTheDocument()
  })
  it('тап — картинка крупно с именем; тап в любое место — закрыть, фокус назад на аватар', () => {
    render(<AvatarZoom name="Маша" url="https://x/a.jpg" />)
    const btn = screen.getByRole('button', { name: /открыть крупно/ })
    btn.focus()
    open()
    const dlg = screen.getByRole('dialog', { name: 'Аватар Маша' })
    expect(dlg.querySelector('img.avatar-lightbox-img')).toHaveAttribute('src', 'https://x/a.jpg')
    expect(dlg).toHaveTextContent('Маша')
    expect(document.documentElement.dataset.sheetOpen).toBe('1')
    fireEvent.click(dlg.querySelector('img'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.documentElement.dataset.sheetOpen).toBeUndefined()
    expect(document.activeElement).toBe(btn)
  })
  it('Escape — закрыть', () => {
    render(<AvatarZoom name="Маша" url="https://x/a.jpg" />)
    open()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('анонимное фото открывается с общей подписью и освобождает прокрутку при уходе', () => {
    const { unmount } = render(<AvatarZoom url="https://x/a.jpg" />)
    const button = screen.getByRole('button', { name: 'Аватар — открыть крупно' })
    button.focus()
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'Аватар' })).toBeInTheDocument()
    unmount()
    expect(document.documentElement.dataset.sheetOpen).toBeUndefined()
  })
  it('закрытие фото сохраняет блокировку прокрутки нижнего листа', () => {
    document.documentElement.dataset.sheetOpen = '1'
    render(<AvatarZoom name="Маша" url="https://x/a.jpg" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть фото' }))
    expect(document.documentElement.dataset.sheetOpen).toBe('1')
    delete document.documentElement.dataset.sheetOpen
  })
  it('новые аватары грузятся в 512 px — чтобы крупно было не мыльно', () => {
    expect(AVATAR_UPLOAD_PX).toBe(512)
  })
})
