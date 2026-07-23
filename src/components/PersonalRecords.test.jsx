// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PersonalRecords from './PersonalRecords.jsx'
import { fmtMetricValue } from '../lib/metric.js'

const recs = () => [
  { exId: 'e1', name: 'Жим лёжа', metric: 'weight', value: 100, isBench: true },
  { exId: 'e2', name: 'Присед', metric: 'weight', value: 140, isBench: false },
]

describe('PersonalRecords', () => {
  it('пустой список → ничего не рендерит', () => {
    const { container } = render(<PersonalRecords records={[]} onOpenProgress={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('рендерит рекорды и форматирует значение по метрике', () => {
    const { container } = render(<PersonalRecords records={recs()} onOpenProgress={() => {}} />)
    expect(screen.getByText('Жим лёжа')).toBeInTheDocument()
    expect(screen.getByText('Присед')).toBeInTheDocument()
    expect(container.textContent).toContain(fmtMetricValue('weight', 100))
  })

  it('тап по строке → onOpenProgress(exId)', () => {
    const onOpen = vi.fn()
    render(<PersonalRecords records={recs()} onOpenProgress={onOpen} />)
    fireEvent.click(screen.getByText('Присед'))
    expect(onOpen).toHaveBeenCalledWith('e2')
  })

  it('звезда тусклая у не-жимового упражнения', () => {
    const { container } = render(<PersonalRecords records={recs()} onOpenProgress={() => {}} />)
    expect(container.querySelectorAll('.star.dim')).toHaveLength(1)
  })
})
