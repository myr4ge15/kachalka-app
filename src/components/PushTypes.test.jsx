// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PushTypes from './PushTypes.jsx'

describe('PushTypes', () => {
  it('v7.1.4: все пять тумблеров сразу, без аккордеона', () => {
    render(<PushTypes prefs={{}} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /Какие присылать/ })).toBeNull()
    expect(screen.getByRole('group', { name: /Какие уведомления/ })).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(5)
  })

  it('по умолчанию все включено, выключенное — выключено', () => {
    render(<PushTypes prefs={{ reminder: false }} onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: /Реакции/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /Напоминание/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('тап отдает тип и новое значение', () => {
    const onChange = vi.fn()
    render(<PushTypes prefs={{}} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch', { name: /рейтинге/ }))
    expect(onChange).toHaveBeenCalledWith('overtake', false)
  })

  it('пока грузится — тумблеры неактивны; ошибка видна', () => {
    render(<PushTypes prefs={null} error="Настройки загрузятся, когда появится сеть." onChange={() => {}} />)
    for (const sw of screen.getAllByRole('switch')) expect(sw).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('появится сеть')
  })

  it('сохраняемый тип занят, остальные доступны', () => {
    render(<PushTypes prefs={{}} busyType="record" onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: /рекорд/ })).toBeDisabled()
    expect(screen.getByRole('switch', { name: /Реакции/ })).toBeEnabled()
  })
})
