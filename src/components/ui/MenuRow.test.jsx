// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MenuRow from './MenuRow.jsx'
import Icon, { ICON_NAMES } from './Icon.jsx'

describe('MenuRow', () => {
  it('переход: иконка, заголовок, пояснение и «›»; нажатие зовет onClick', () => {
    const onClick = vi.fn()
    const { container } = render(<MenuRow icon="users" title="Друзья" sub="2 заявки" onClick={onClick} />)
    const row = screen.getByRole('button', { name: /Друзья/ })
    expect(row).toHaveClass('act', 'menu-row')
    expect(row).toHaveTextContent('2 заявки')
    expect(container.querySelector('.act-ico svg')).not.toBeNull()
    expect(container.querySelector('.menu-row-chev')).not.toBeNull()
    expect(row).not.toHaveAttribute('aria-expanded')
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('раскрытие: aria-expanded и класс открытой строки', () => {
    const { rerender } = render(<MenuRow kind="expand" title="Пригласить" />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    rerender(<MenuRow kind="expand" open title="Пригласить" />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button')).toHaveClass('is-open')
  })

  it('тумблер: role=switch и положение', () => {
    const { container } = render(<MenuRow kind="switch" checked title="Таймер отдыха" />)
    expect(screen.getByRole('switch', { name: 'Таймер отдыха' })).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelector('.toggle-pill.on')).not.toBeNull()
  })

  it('действие без хвоста; опасная строка; бейдж и подсветка; свой хвост', () => {
    const { container, rerender } = render(<MenuRow kind="action" tone="danger" title="Удалить" />)
    expect(container.querySelector('.menu-row-chev')).toBeNull()
    expect(screen.getByRole('button')).toHaveClass('danger')
    rerender(<MenuRow title="Что нового" badge="новое" highlight />)
    expect(screen.getByRole('button')).toHaveClass('act-new')
    expect(screen.getByText('новое')).toHaveClass('act-badge')
    rerender(<MenuRow kind="switch" title="Пуши" end={<span data-testid="end" />} />)
    expect(screen.getByTestId('end')).toBeInTheDocument()
    expect(container.querySelector('.toggle-pill')).toBeNull()
  })

  it('без иконки и без пояснения — только заголовок', () => {
    const { container } = render(<MenuRow title="Шаблоны" sub="" />)
    expect(container.querySelector('.act-ico')).toBeNull()
    expect(container.querySelector('.act-sub')).toBeNull()
  })
})

describe('Icon', () => {
  it('каждое имя рисует SVG, неизвестное — ничего', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg.ui-icon'), name).not.toBeNull()
      unmount()
    }
    const { container } = render(<Icon name="нет-такой" />)
    expect(container).toBeEmptyDOMElement()
  })
})
