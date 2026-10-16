// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import FeedPrBadge, { prForEntry } from './FeedPrBadge.jsx'

describe('FeedPrBadge — рекорд в строке упражнения (аудит 16.10)', () => {
  it('показывает кубок и значение, имя — в подсказке и для скринридера', () => {
    const { container } = render(
      <FeedPrBadge pr={{ name: 'Жим гантелей лежа на наклонной скамье', metric: 'weight', value: 32 }} />
    )
    expect(screen.getByText('🏆 32 кг')).toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute('aria-label', 'новый рекорд 32 кг')
    expect(container.firstChild).toHaveAttribute(
      'title',
      'Новый личный рекорд: Жим гантелей лежа на наклонной скамье — 32 кг'
    )
  })

  it('форматирует рекорд по ведущей метрике', () => {
    render(<FeedPrBadge pr={{ name: 'Планка', metric: 'time', value: 95 }} />)
    expect(screen.getByText('🏆 1:35')).toBeInTheDocument()
  })

  it('prForEntry находит рекорд строки по имени упражнения', () => {
    const w = { prs: [{ name: 'Жим лежа', metric: 'weight', value: 90 }] }
    expect(prForEntry(w, { name: 'Жим лежа' })).toEqual(w.prs[0])
    expect(prForEntry(w, { name: 'Планка' })).toBeNull()
    expect(prForEntry({}, { name: 'Жим лежа' })).toBeNull()
  })
})
