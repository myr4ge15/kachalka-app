// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import WelcomeSheet from './WelcomeSheet.jsx'
import { WELCOME_STEPS } from '../lib/welcome.js'

const last = WELCOME_STEPS.length - 1

describe('WelcomeSheet', () => {
  it('«Дальше» листает карточки, на последней — «Записать первую тренировку»', () => {
    const onStart = vi.fn()
    render(<WelcomeSheet onStart={onStart} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Добро пожаловать' })).toBeInTheDocument()
    expect(screen.getByText(WELCOME_STEPS[0].title)).toBeInTheDocument()
    for (let i = 0; i < last; i++) fireEvent.click(screen.getByRole('button', { name: 'Дальше' }))
    expect(screen.getByText(WELCOME_STEPS[last].title)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Дальше' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Записать первую тренировку' }))
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('«Пропустить» закрывает лист с любой карточки', () => {
    const onClose = vi.fn()
    render(<WelcomeSheet onStart={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('точки переключают карточку и показывают текущую', () => {
    render(<WelcomeSheet onStart={vi.fn()} onClose={vi.fn()} />)
    const dot = screen.getByRole('button', { name: `Шаг 3 из ${WELCOME_STEPS.length}` })
    fireEvent.click(dot)
    expect(screen.getByText(WELCOME_STEPS[2].title)).toBeInTheDocument()
    expect(dot).toHaveAttribute('aria-current', 'step')
  })

  it('свайп влево — вперед, вправо — назад', () => {
    render(<WelcomeSheet onStart={vi.fn()} onClose={vi.fn()} />)
    const card = screen.getByText(WELCOME_STEPS[0].title).closest('.welcome-card')
    fireEvent.touchStart(card, { touches: [{ clientX: 300 }] })
    fireEvent.touchEnd(card, { changedTouches: [{ clientX: 200 }] })
    expect(screen.getByText(WELCOME_STEPS[1].title)).toBeInTheDocument()
    fireEvent.touchStart(card, { touches: [{ clientX: 100 }] })
    fireEvent.touchEnd(card, { changedTouches: [{ clientX: 220 }] })
    expect(screen.getByText(WELCOME_STEPS[0].title)).toBeInTheDocument()
  })
})
