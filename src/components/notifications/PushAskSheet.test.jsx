// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PushAskSheet from './PushAskSheet.jsx'

describe('PushAskSheet', () => {
  it('«Включить» запрашивает разрешение и закрывается с успехом', async () => {
    const onEnable = vi.fn().mockResolvedValue()
    const onClose = vi.fn()
    render(<PushAskSheet onEnable={onEnable} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Уведомления' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
    expect(onEnable).toHaveBeenCalledTimes(1)
  })

  it('ошибка остается в листе, можно попробовать снова', async () => {
    const onEnable = vi.fn().mockRejectedValue(new Error('Уведомления запрещены — разреши их в настройках.'))
    const onClose = vi.fn()
    render(<PushAskSheet onEnable={onEnable} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('запрещены')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Включить' })).toBeEnabled()
  })

  it('«Не сейчас» закрывает без включения', () => {
    const onEnable = vi.fn()
    const onClose = vi.fn()
    render(<PushAskSheet onEnable={onEnable} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }))
    expect(onClose).toHaveBeenCalledWith(false)
    expect(onEnable).not.toHaveBeenCalled()
  })
})
