// @vitest-environment jsdom
// Фолбэк упавшей вкладки: объясняет, что данные целы, и дает повторить рендер.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ScreenCrash from './ScreenCrash.jsx'

describe('ScreenCrash', () => {
  it('заголовок, пояснение про сохраненные данные; «Попробовать снова» зовет onRetry', () => {
    const onRetry = vi.fn()
    render(<ScreenCrash onRetry={onRetry} />)
    expect(screen.getByRole('heading', { name: 'Экран не открылся' })).toBeInTheDocument()
    expect(screen.getByText(/сохранены\s+локально/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
