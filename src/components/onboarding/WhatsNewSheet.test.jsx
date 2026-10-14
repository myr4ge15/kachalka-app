// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import WhatsNewSheet from './WhatsNewSheet.jsx'

const release = {
  version: '6.4.0', date: '2026-10-01', count: 1,
  main: [{ e: '📱', t: 'Телефон набок' }, { e: '🎨', t: 'Одни цвета' }],
  minor: [{ e: '🔄', t: 'Стрелки в такт' }, { e: '⚡', t: 'Шрифт легче' }],
}

describe('WhatsNewSheet (v6.4.0)', () => {
  it('главное сразу, мелочи — по тапу', () => {
    render(<WhatsNewSheet release={release} onDone={() => {}} onOpenAll={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Что нового' })).toBeInTheDocument()
    expect(screen.getByText('v6.4.0')).toBeInTheDocument()
    expect(screen.getByText('Телефон набок')).toBeInTheDocument()
    expect(screen.queryByText('Шрифт легче')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /И еще 2 мелочи/ }))
    expect(screen.getByText('Шрифт легче')).toBeInTheDocument()
  })
  it('«Понятно» и «Все обновления»', () => {
    const onDone = vi.fn()
    const onOpenAll = vi.fn()
    render(<WhatsNewSheet release={release} onDone={onDone} onOpenAll={onOpenAll} />)
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Все обновления' }))
    expect(onOpenAll).toHaveBeenCalledTimes(1)
  })
})
