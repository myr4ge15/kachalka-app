// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatGrid from './StatGrid.jsx'
import { fmtTonnage } from '../lib/profileStats.js'

describe('StatGrid', () => {
  it('показывает число тренировок и подписи', () => {
    render(<StatGrid totalWorkouts={42} tonnage={12345} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText(/тренировки/)).toBeInTheDocument() // 42 тренировки
    expect(screen.getByText(/поднято/)).toBeInTheDocument()
  })

  it('склоняет подпись: 1 тренировка, 5 тренировок', () => {
    const { container, rerender } = render(<StatGrid totalWorkouts={1} tonnage={0} />)
    expect(container.textContent).toContain('тренировкавсего')
    rerender(<StatGrid totalWorkouts={5} tonnage={0} />)
    expect(container.textContent).toContain('тренировоквсего')
  })

  it('масштабирует тоннаж через fmtTonnage', () => {
    const { container } = render(<StatGrid totalWorkouts={1} tonnage={12345} />)
    const t = fmtTonnage(12345)
    expect(container.textContent).toContain(`${t.value} ${t.unit}`)
  })
})
