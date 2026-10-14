// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import BackButton from './BackButton.jsx'

describe('BackButton', () => {
  it('подписан для скринридера и зовет onClick', () => {
    const onClick = vi.fn()
    render(<BackButton onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
  it('своя подпись', () => {
    render(<BackButton onClick={() => {}} label="Назад в профиль" />)
    expect(screen.getByRole('button', { name: 'Назад в профиль' })).toBeInTheDocument()
  })
})
