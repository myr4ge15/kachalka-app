// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SetsCells from './SetsCells.jsx'

const s = (weight, reps) => ({ weight, reps })

describe('SetsCells', () => {
  it('свой вес с помощью/доп. весом — строкой со знаком, без колонок (v7.5.2)', () => {
    const { container } = render(<span data-testid="a"><SetsCells metric="reps" sets={[s(-10, 12), s(0, 8), s(17.5, 6)]} /></span>)
    expect(container.querySelector('.sets-cols')).toBeNull()
    expect(screen.getByTestId('a').textContent).toBe('−10×12, 8, +17.5×6')
  })

  it('без веса и у весовых — строка, пусто — прочерк', () => {
    render(<>
      <span data-testid="r"><SetsCells metric="reps" sets={[s(0, 12), s(0, 10)]} /></span>
      <span data-testid="w"><SetsCells metric="weight" sets={[s(90, 5), s(85, 5)]} /></span>
      <span data-testid="e"><SetsCells metric="weight" sets={[]} /></span></>)
    expect(screen.getByTestId('r').textContent).toBe('12, 10')
    expect(screen.getByTestId('w').textContent).toBe('90×5, 85×5')
    expect(screen.getByTestId('e').textContent).toBe('—')
  })
})
