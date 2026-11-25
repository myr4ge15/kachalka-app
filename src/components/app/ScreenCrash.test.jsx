// @vitest-environment jsdom
// Фолбэк упавшей вкладки: объясняет, что данные целы, и дает повторить рендер.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ScreenCrash from './ScreenCrash.jsx'
import { reloadForUpdatePush } from '../../lib/launchUpdate.js'
vi.mock('../../lib/launchUpdate.js', () => ({ reloadForUpdatePush: vi.fn().mockResolvedValue('reload') }))

describe('ScreenCrash', () => {
  it('после ошибки загрузки модуля запускает обновление по нажатию', () => {
    const retry = vi.fn()
    render(<ScreenCrash error={new Error("'text/html' is not a valid JavaScript MIME type for module script")} onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Перезагрузить приложение' }))
    expect(reloadForUpdatePush).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
  })
  it('заголовок, пояснение про сохраненные данные; «Попробовать снова» зовет onRetry', () => {
    const onRetry = vi.fn()
    render(<ScreenCrash onRetry={onRetry} />)
    expect(screen.getByRole('heading', { name: 'Экран не открылся' })).toBeInTheDocument()
    expect(screen.getByText(/сохранены\s+локально/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
