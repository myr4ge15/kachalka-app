// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import RivalryCard from './RivalryCard.jsx'

const rivalry = {
  me: { user_id: 'me', user_name: 'Саня', weight: 95, reps: 6 },
  rival: { user_id: 'dima', user_name: 'Дима', weight: 100, reps: 5 },
  myPlace: 2,
  rivalPlace: 1,
  direction: 'above',
  tied: false,
  gap: 5,
  gapMetric: 'weight',
  progress: 95,
}

describe('RivalryCard', () => {
  it('показывает нейтральный ориентир и раскрывает две строки', () => {
    render(<RivalryCard rivalry={rivalry} />)

    const toggle = screen.getByRole('button', { name: /До Дима — 5 кг/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Сравнение результатов')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const details = screen.getByLabelText('Сравнение результатов')
    expect(details).toHaveTextContent('Дима')
    expect(details).toHaveTextContent('Ты')
    expect(details).toHaveTextContent('100 кг')
    expect(details).toHaveTextContent('95 кг')
  })

  it('для лидера не использует давящую формулировку', () => {
    render(<RivalryCard rivalry={{ ...rivalry, direction: 'below', gap: 5 }} />)

    expect(screen.getByText('Дима рядом — разница 5 кг')).toBeInTheDocument()
    expect(screen.queryByText(/проигрываешь|хуже|последний/i)).not.toBeInTheDocument()
  })

  it('ничего не добавляет для пустого состояния', () => {
    const { container } = render(<RivalryCard rivalry={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
