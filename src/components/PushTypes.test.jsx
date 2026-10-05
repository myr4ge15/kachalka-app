// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PushTypes from './PushTypes.jsx'

// v6.12.0: список свернут в строку «Какие присылать» — раскрываем перед проверкой.
const expand = () => fireEvent.click(screen.getByRole('button', { name: /Какие присылать/ }))

describe('PushTypes', () => {
  it('свернуто по умолчанию: одна строка со счетчиком, раскрывается и сворачивается', () => {
    render(<PushTypes prefs={{ reminder: false }} onChange={() => {}} />)
    const toggle = screen.getByRole('button', { name: /Какие присылать/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('включено 4 из 5')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    fireEvent.click(toggle)
    expect(screen.getAllByRole('switch')).toHaveLength(5)
    fireEvent.click(toggle)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('ошибка сохранения видна и в свернутом виде', () => {
    render(<PushTypes prefs={{}} error="Не удалось сохранить." onChange={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить.')
  })

  it('по умолчанию все включено, выключенное — выключено', () => {
    render(<PushTypes prefs={{ reminder: false }} onChange={() => {}} />)
    expand()
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(5)
    expect(screen.getByRole('switch', { name: /Реакции/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /Напоминание/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('тап отдает тип и новое значение', () => {
    const onChange = vi.fn()
    render(<PushTypes prefs={{}} onChange={onChange} />)
    expand()
    fireEvent.click(screen.getByRole('switch', { name: /рейтинге/ }))
    expect(onChange).toHaveBeenCalledWith('overtake', false)
  })

  it('пока грузится — тумблеры неактивны; ошибка видна', () => {
    render(<PushTypes prefs={null} error="Настройки загрузятся, когда появится сеть." onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Какие присылать/ })).toHaveTextContent('загружаю…')
    expand()
    for (const sw of screen.getAllByRole('switch')) expect(sw).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('появится сеть')
  })

  it('сохраняемый тип занят, остальные доступны', () => {
    render(<PushTypes prefs={{}} busyType="record" onChange={() => {}} />)
    expand()
    expect(screen.getByRole('switch', { name: /рекорд/ })).toBeDisabled()
    expect(screen.getByRole('switch', { name: /Реакции/ })).toBeEnabled()
  })
})
