// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SetsCells, { SetsCaption } from './SetsCells.jsx'

const s = (weight, reps) => ({ weight, reps })

describe('SetsCells (v7.2.3)', () => {
  it('свой вес с помощью — колонки «повторы над весом» и подпись под названием', () => {
    const { container } = render(<><SetsCaption metric="reps" sets={[s(-10, 12), s(-25, 13)]} />
      <SetsCells metric="reps" sets={[s(-10, 12), s(-25, 13)]} /></>)
    const cols = container.querySelectorAll('.sets-col')
    expect(cols).toHaveLength(2)
    expect(cols[1].textContent).toBe('13−25')
    expect(screen.getByRole('listitem', { name: '12 повт., −10 кг' })).toBeInTheDocument()
    expect(screen.getByText('повт. · вес, кг')).toBeInTheDocument()
  })

  it('без веса и у весовых — строка как раньше, без подписи', () => {
    const { container } = render(<><SetsCaption metric="reps" sets={[s(0, 12), s(0, 10)]} />
      <span data-testid="r"><SetsCells metric="reps" sets={[s(0, 12), s(0, 10)]} /></span>
      <span data-testid="w"><SetsCells metric="weight" sets={[s(90, 5), s(85, 5)]} /></span>
      <span data-testid="e"><SetsCells metric="weight" sets={[]} /></span></>)
    expect(container.querySelector('.sets-cols')).toBeNull()
    expect(container.querySelector('.sets-caption')).toBeNull()
    expect(screen.getByTestId('r').textContent).toBe('12, 10')
    expect(screen.getByTestId('w').textContent).toBe('90×5, 85×5')
    expect(screen.getByTestId('e').textContent).toBe('—')
  })
})
