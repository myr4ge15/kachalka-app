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

  it('уточнения пункта — вложенным списком под ним (v8.0.0)', () => {
    const items = [{ e: '📷', t: 'Сканер на весь экран', sub: ['фонарик', 'русские надписи'] }, { e: '🔐', t: 'PIN' }]
    const { container } = render(<WhatsNewItems items={items} />)
    const sub = container.querySelector('.wn-sub')
    expect(sub.querySelectorAll('li')).toHaveLength(2)
    expect(sub.closest('li')).toHaveTextContent('Сканер на весь экран')
    expect(container.querySelectorAll('.wn-sub')).toHaveLength(1)
  })
})
