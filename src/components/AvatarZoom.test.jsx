// @vitest-environment jsdom
// Аватар крупно (v6.18.0).
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AvatarZoom from './AvatarZoom.jsx'
import { AVATAR_UPLOAD_PX } from '../lib/avatar.js'

describe('AvatarZoom', () => {
  it('без картинки — просто инициал, не кнопка', () => {
    render(<AvatarZoom name="Маша" url={null} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('М')).toBeInTheDocument()
  })
  it('тап — лист с картинкой крупно, «закрыть» — убирает', () => {
    render(<AvatarZoom name="Маша" url="https://x/a.jpg" />)
    fireEvent.click(screen.getByRole('button', { name: /Аватар Маша — открыть крупно/ }))
    const dlg = screen.getByRole('dialog', { name: 'Маша' })
    expect(dlg.querySelector('img.avatar-zoom-img')).toHaveAttribute('src', 'https://x/a.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('новые аватары грузятся в 512 px — чтобы крупно было не мыльно', () => {
    expect(AVATAR_UPLOAD_PX).toBe(512)
  })
})
