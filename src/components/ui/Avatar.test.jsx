// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import Avatar from './Avatar.jsx'

describe('Avatar', () => {
  it('без картинки — заглавный инициал, класс снаружи', () => {
    const { container } = render(<Avatar name="  петя" className="avatar-lg" />)
    const el = container.firstChild
    expect(el.tagName).toBe('DIV')
    expect(el).toHaveClass('avatar-lg')
    expect(el).toHaveTextContent('П')
  })

  it('пустое/отсутствующее имя → «?»', () => {
    expect(render(<Avatar name="   " />).container.firstChild).toHaveTextContent('?')
    expect(render(<Avatar />).container.firstChild).toHaveTextContent('?')
  })

  it('есть url — картинка; не загрузилась — тихо инициал; новый url — снова картинка', () => {
    const { container, rerender } = render(<Avatar name="Вася" url="https://x/a.jpg" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://x/a.jpg')
    expect(img).toHaveClass('avatar', 'has-img')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstChild).toHaveTextContent('В')
    rerender(<Avatar name="Вася" url="https://x/b.jpg" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x/b.jpg')
  })
})
