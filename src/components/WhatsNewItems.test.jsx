// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import WhatsNewItems from './WhatsNewItems.jsx'

describe('WhatsNewItems', () => {
  it('пункт = эмодзи (скрыт от скринридера) + текст; compact меняет класс', () => {
    const items = [{ e: '🔥', t: 'Рекорды видно сразу' }, { e: '📅', t: 'Календарь' }]
    const { container, rerender } = render(<WhatsNewItems items={items} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Рекорды видно сразу')).toBeInTheDocument()
    expect(container.querySelector('.wn-em')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('ul')).toHaveClass('wn-list')
    expect(container.querySelector('ul')).not.toHaveClass('compact')
    rerender(<WhatsNewItems items={items} compact />)
    expect(container.querySelector('ul')).toHaveClass('wn-list', 'compact')
  })
})
