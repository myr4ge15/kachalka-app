// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AddFab from './AddFab.jsx'

describe('AddFab', () => {
  it('доступен скринридеру и зовёт onClick', () => {
    const onClick = vi.fn()
    render(<AddFab onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Записать тренировку' })
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('без onClick не падает по клику', () => {
    render(<AddFab />)
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()
  })
})
