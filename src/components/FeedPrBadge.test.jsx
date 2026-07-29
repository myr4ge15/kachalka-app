// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import FeedPrBadge from './FeedPrBadge.jsx'

describe('FeedPrBadge', () => {
  it('отделяет длинное название от неразрывного значения рекорда', () => {
    const { container } = render(
      <FeedPrBadge
        pr={{
          name: 'Жим гантелей лёжа на наклонной скамье',
          metric: 'weight',
          value: 32,
        }}
      />
    )

    expect(screen.getByText('Жим гантелей лёжа на наклонной скамье'))
      .toHaveClass('pr-badge-name')
    expect(screen.getByText('· 32 кг')).toHaveClass('pr-badge-value')
    expect(container.firstChild).toHaveAttribute(
      'title',
      'Новый личный рекорд: Жим гантелей лёжа на наклонной скамье — 32 кг'
    )
  })

  it('форматирует рекорд по ведущей метрике', () => {
    render(<FeedPrBadge pr={{ name: 'Планка', metric: 'time', value: 95 }} />)
    expect(screen.getByText('· 1:35')).toBeInTheDocument()
  })
})
