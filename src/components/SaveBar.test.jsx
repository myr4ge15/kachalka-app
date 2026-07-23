// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SaveBar from './SaveBar.jsx'

describe('SaveBar', () => {
  it('показывает число подходов и сохраняет по клику', () => {
    const onSave = vi.fn()
    render(<SaveBar canSave saving={false} totalSets={5} onSave={onSave} />)
    const btn = screen.getByRole('button', { name: /Сохранить \(5\)/ })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('totalSets=0 → без счётчика', () => {
    render(<SaveBar canSave saving={false} totalSets={0} onSave={() => {}} />)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()
  })

  it('saving → «Сохранение…»', () => {
    render(<SaveBar canSave={false} saving totalSets={3} onSave={() => {}} />)
    expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled()
  })

  it('canSave=false → кнопка заблокирована', () => {
    render(<SaveBar canSave={false} saving={false} totalSets={2} onSave={() => {}} />)
    expect(screen.getByRole('button', { name: /Сохранить/ })).toBeDisabled()
  })
})
