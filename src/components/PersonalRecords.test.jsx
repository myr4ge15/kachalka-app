// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PersonalRecords from './PersonalRecords.jsx'
import { fmtMetricValue } from '../lib/metric.js'

const recs = () => [
  { exId: 'e1', name: 'Жим лёжа', metric: 'weight', value: 100, isBench: true },
  { exId: 'e2', name: 'Присед', metric: 'weight', value: 140, isBench: false },
]

const manyRecs = () => [
  ...recs(),
  { exId: 'e3', name: 'Становая тяга', metric: 'weight', value: 160, isBench: false },
  { exId: 'e4', name: 'Подтягивания', metric: 'reps', value: 15, isBench: false },
  { exId: 'e5', name: 'Планка', metric: 'time', value: 90, isBench: false },
  { exId: 'e6', name: 'Жим ногами', metric: 'weight', value: 200, isBench: false },
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

  it('показывает звезду только у жима', () => {
    const { container } = render(<PersonalRecords records={recs()} onOpenProgress={() => {}} />)
    expect(container.querySelectorAll('.star')).toHaveLength(1)
    expect(container.querySelector('.star')).toHaveTextContent('★')
  })

  it('длинный список свёрнут до пяти записей и показывает общее число', () => {
    render(<PersonalRecords records={manyRecs()} onOpenProgress={() => {}} />)

    expect(screen.getByLabelText('6 рекордов')).toBeInTheDocument()
    expect(screen.getByText('Планка')).toBeInTheDocument()
    expect(screen.queryByText('Жим ногами')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Показать все 6/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('раскрывает полный список и снова сворачивает его', () => {
    render(<PersonalRecords records={manyRecs()} onOpenProgress={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /Показать все 6/ }))
    expect(screen.getByText('Жим ногами')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Свернуть/ })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: /Свернуть/ }))
    expect(screen.queryByText('Жим ногами')).not.toBeInTheDocument()
  })

  it('не показывает кнопку раскрытия для короткого списка', () => {
    render(<PersonalRecords records={recs()} onOpenProgress={() => {}} />)
    expect(screen.queryByRole('button', { name: /Показать все/ })).not.toBeInTheDocument()
  })
})
