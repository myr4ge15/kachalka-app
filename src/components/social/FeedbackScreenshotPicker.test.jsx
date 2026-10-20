// @vitest-environment jsdom
// Вложения обращения (покрытие тестами 20.10.2026: ветки 63 %): кнопка открывает выбор,
// неподходящий файл и перебор — понятная ошибка; видео — плашка с размером; «Убрать».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import FeedbackScreenshotPicker from './FeedbackScreenshotPicker.jsx'

const png = (n = 'a.png') => new File(['x'], n, { type: 'image/png' })
const mp4 = (size = 3 * 1024 * 1024) => { const f = new File(['x'], 'v.mp4', { type: 'video/mp4' }); Object.defineProperty(f, 'size', { value: size }); return f }

beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn() })
afterEach(() => vi.clearAllMocks())

describe('FeedbackScreenshotPicker', () => {
  it('«Приложить» открывает выбор; выбранные уходят наверх', () => {
    const onChange = vi.fn()
    render(<FeedbackScreenshotPicker files={[]} onChange={onChange} />)
    const input = screen.getByTestId('fb-file')
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: /Приложить скриншоты или видео/ }))
    expect(click).toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [png(), png('b.png')] } })
    expect(onChange).toHaveBeenCalledWith([expect.any(File), expect.any(File)])
  })

  it('больше лимита — «Можно добавить еще N», без изменения', () => {
    const onChange = vi.fn()
    render(<FeedbackScreenshotPicker files={[png(), png()]} max={3} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('fb-file'), { target: { files: [png(), png()] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Можно добавить еще 1 вложений.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('не картинка и не видео — ошибка с причиной', () => {
    const onChange = vi.fn()
    render(<FeedbackScreenshotPicker files={[]} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('fb-file'), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('видео — плашка с размером; «Убрать» убирает нужное; на лимите «Добавить еще» неактивна', () => {
    const onChange = vi.fn()
    render(<FeedbackScreenshotPicker files={[png(), mp4()]} max={2} onChange={onChange} />)
    expect(screen.getByLabelText('Видео к обращению 2')).toBeInTheDocument()
    expect(screen.getByText(/▶ Видео · 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Добавить еще/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Убрать скриншот 1' }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'v.mp4' })])
  })
})
