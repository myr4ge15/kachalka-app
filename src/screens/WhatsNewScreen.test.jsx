// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import WhatsNewScreen from './WhatsNewScreen.jsx'
import { OPENED_KEY } from '../lib/whatsNew.js'

const entries = [
  { version: '6.4.0', date: '2026-10-01', headline: 'Новое', main: [{ e: '📱', t: 'Телефон набок' }], minor: [{ e: '⚡', t: 'Шрифт легче' }] },
  { version: '6.3.4', date: '2026-09-30', big: true, headline: 'Новый дизайн', main: [{ e: '🎨', t: 'Ночной фон' }], minor: [] },
]

describe('WhatsNewScreen (v6.4.0)', () => {
  beforeEach(() => localStorage.clear())

  it('свежая запись раскрыта, прошлая — одной строкой, тап раскрывает', () => {
    render(<WhatsNewScreen onBack={() => {}} entries={entries} />)
    expect(screen.getByText('Телефон набок')).toBeInTheDocument()
    expect(screen.getByText('Шрифт легче')).toBeInTheDocument()
    expect(screen.getByText('большое')).toBeInTheDocument()
    expect(screen.queryByText('Ночной фон')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /6\.3\.4/ }))
    expect(screen.getByText('Ночной фон')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /6\.3\.4/ }))
    expect(screen.queryByText('Ночной фон')).toBeNull()
  })

  it('открытие гасит метку «новое» в Настройках', () => {
    render(<WhatsNewScreen onBack={() => {}} entries={entries} />)
    expect(localStorage.getItem(OPENED_KEY)).toBe('6.4.0')
  })

  it('пустая история не перезаписывает отметку прочтения', () => {
    localStorage.setItem(OPENED_KEY, '6.3.4')
    render(<WhatsNewScreen entries={[]} />)
    expect(screen.getByRole('heading', { name: 'Обновления' })).toBeInTheDocument()
    expect(localStorage.getItem(OPENED_KEY)).toBe('6.3.4')
  })

  it('свернутая запись без заголовка показывает первое изменение', () => {
    render(<WhatsNewScreen entries={[entries[0], { ...entries[1], headline: undefined }]} />)
    expect(screen.getByText(/Ночной фон/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /6\.3\.4/ })).toHaveAttribute('aria-expanded', 'false')
  })
})
