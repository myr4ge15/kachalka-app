// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PushToggle from './PushToggle.jsx'

describe('PushToggle', () => {
  it('без VAPID-ключа и до проверки браузера строки нет', () => {
    const { container, rerender } = render(<PushToggle availability="off" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<PushToggle availability={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('переключатель отдает новое состояние', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<PushToggle availability="ok" enabled={false} onToggle={onToggle} />)
    const sw = screen.getByRole('switch', { name: /Пуш-уведомления/ })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    // Без пояснения под заголовком (v6.6.1): название говорит само за себя.
    expect(sw).toHaveTextContent(/^🔔 Пуш-уведомления$/)
    fireEvent.click(sw)
    expect(onToggle).toHaveBeenCalledWith(true)

    rerender(<PushToggle availability="ok" enabled onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenLastCalledWith(false)
  })

  it('во время переключения кнопка занята, ошибка видна', () => {
    // Тумблер уже в новом положении (оптимистично, v6.7.1) — статус по нему.
    render(<PushToggle availability="ok" enabled busy error="Нет сети — попробуй позже." onToggle={() => {}} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByText('Включаю…')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Нет сети')
  })

  it('iPhone во вкладке Safari — подсказка вместо переключателя', () => {
    render(<PushToggle availability="ios-install" />)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(/На экран „Домой“/)).toBeInTheDocument()
  })

  it('запрет в браузере — объясняем, где разрешить', () => {
    render(<PushToggle availability="denied" />)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(/Запрещены в настройках/)).toBeInTheDocument()
  })
})
