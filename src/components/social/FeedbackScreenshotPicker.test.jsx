// @vitest-environment jsdom
// Вложения обращения: кнопка открывает выбор, неподходящий файл и перебор — понятная ошибка;
// предзагрузка (20.10.2026): кольцо с процентами, ✓ готово, «Повторить», кадр видео; крестик.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FeedbackScreenshotPicker from './FeedbackScreenshotPicker.jsx'

const png = (n = 'a.png') => new File(['x'], n, { type: 'image/png' })
const mp4 = (size = 3 * 1024 * 1024) => { const f = new File(['x'], 'v.mp4', { type: 'video/mp4' }); Object.defineProperty(f, 'size', { value: size }); return f }
let seq = 0
const item = (file, over = {}) => ({
  key: 'k' + ++seq, file, video: file.type.startsWith('video/'), status: 'done', loaded: file.size, total: file.size,
  path: 'me/x', poster: null, error: '', ...over,
})
const props = (over = {}) => ({ items: [], onAdd: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(), ...over })

beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn() })
afterEach(() => vi.clearAllMocks())

describe('FeedbackScreenshotPicker', () => {
  it('«Приложить» открывает выбор; выбранные уходят наверх', () => {
    const p = props()
    render(<FeedbackScreenshotPicker {...p} />)
    const input = screen.getByTestId('fb-file')
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: /Приложить скриншоты или видео/ }))
    expect(click).toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [png(), png('b.png')] } })
    expect(p.onAdd).toHaveBeenCalledWith([expect.any(File), expect.any(File)])
  })

  it('больше лимита — добавляются первые, что влезают, и подсказка (fb_9e79f821)', () => {
    const p = props({ items: [item(png()), item(png())], max: 3 })
    render(<FeedbackScreenshotPicker {...p} />)
    const a = png('a.png')
    fireEvent.change(screen.getByTestId('fb-file'), { target: { files: [a, png('b.png')] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Добавлено 1 из 2: всего можно 3 вложения.')
    expect(p.onAdd).toHaveBeenCalledWith([a])
  })

  it('выбрали 6 при пустом списке — добавлены 5', () => {
    const p = props()
    render(<FeedbackScreenshotPicker {...p} />)
    fireEvent.change(screen.getByTestId('fb-file'), { target: { files: [1, 2, 3, 4, 5, 6].map((n) => png(n + '.png')) } })
    expect(p.onAdd.mock.calls[0][0]).toHaveLength(5)
    expect(screen.getByRole('alert')).toHaveTextContent('Добавлено 5 из 6: всего можно 5 вложений.')
  })

  it('не картинка и не видео — ошибка с причиной', () => {
    const p = props()
    render(<FeedbackScreenshotPicker {...p} />)
    fireEvent.change(screen.getByTestId('fb-file'), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement()
    expect(p.onAdd).not.toHaveBeenCalled()
  })

  it('убрать — крестик в углу самой миниатюры, без текста (fb_7e661cff), а не кнопка «Убрать» под ней', () => {
    render(<FeedbackScreenshotPicker {...props({ items: [item(png())] })} />)
    const rm = screen.getByRole('button', { name: 'Убрать скриншот' })
    expect(rm).toHaveClass('fb-shot-rm')
    expect(rm.textContent).toBe('') // только значок ✕
    expect(rm.querySelector('svg')).not.toBeNull()
    expect(rm.parentElement).toContainElement(screen.getByAltText('Скриншот к обращению')) // в той же карточке, что и картинка
    expect(screen.queryByText('Убрать')).toBeNull()
  })

  it('видео без кадра — плашка с размером; крестик убирает нужное; на лимите «Добавить еще» неактивна', () => {
    const a = item(png()), v = item(mp4())
    const p = props({ items: [a, v], max: 2 })
    render(<FeedbackScreenshotPicker {...p} />)
    expect(screen.getByLabelText('Видео к обращению 2')).toBeInTheDocument()
    expect(screen.getByText(/▶ Видео · 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Добавить еще/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Убрать скриншот 1' }))
    expect(p.onRemove).toHaveBeenCalledWith(a.key)
  })

  it('видео с кадром — картинкой, а не черным <video>', () => {
    const { container } = render(<FeedbackScreenshotPicker {...props({ items: [item(mp4(), { poster: 'data:image/jpeg;base64,AA' })] })} />)
    expect(screen.getByAltText('Видео к обращению')).toHaveAttribute('src', 'data:image/jpeg;base64,AA')
    expect(container.querySelector('video')).toBeNull()
  })

  it('загрузка видео — кольцо с процентами; картинки — без процентов; готово — ✓', () => {
    const v = item(mp4(1000), { status: 'uploading', loaded: 420, total: 1000 })
    const i = item(png(), { status: 'uploading', loaded: 0 })
    const d = item(png())
    render(<FeedbackScreenshotPicker {...props({ items: [v, i, d] })} />)
    expect(screen.getByRole('status', { name: 'Загружается 1: 42%' })).toHaveTextContent('42%')
    cleanup()
    // байты ушли, сервер еще не ответил — без «100%», просто крутится (fb_8e7257c6)
    render(<FeedbackScreenshotPicker {...props({ items: [item(mp4(1000), { status: 'uploading', loaded: 1000, total: 1000 })] })} />)
    expect(screen.getByRole('status', { name: 'Загружается' })).toHaveTextContent('')
    cleanup()
    render(<FeedbackScreenshotPicker {...props({ items: [v, i, d] })} />)
    expect(screen.getByRole('status', { name: 'Загружается 2' })).toHaveTextContent('')
    expect(screen.getByRole('img', { name: 'Загружено 3' }).querySelector('svg')).not.toBeNull()
    // крестик работает и во время загрузки
    expect(screen.getByRole('button', { name: 'Убрать скриншот 1' })).toBeEnabled()
  })

  it('пока грузится — подсказка не сворачивать приложение; загрузилось — подсказки нет (fb_37f0c1a8)', () => {
    const v = mp4()
    const { rerender } = render(<FeedbackScreenshotPicker {...props({ items: [item(v, { status: 'uploading', loaded: 0 })] })} />)
    expect(screen.getByText(/Не сворачивай приложение/)).toBeInTheDocument()
    rerender(<FeedbackScreenshotPicker {...props({ items: [item(v)] })} />)
    expect(screen.queryByText(/Не сворачивай приложение/)).toBeNull()
  })

  it('ошибка загрузки — «Повторить» зовет onRetry с ключом', () => {
    const e = item(png(), { status: 'error', error: 'Не загрузилось' })
    const p = props({ items: [e] })
    render(<FeedbackScreenshotPicker {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
    expect(p.onRetry).toHaveBeenCalledWith(e.key)
  })

  it('ссылки на картинки освобождаются, когда картинку убрали и при уходе', () => {
    const a = item(png()), b = item(png())
    const { rerender, unmount } = render(<FeedbackScreenshotPicker {...props({ items: [a, b] })} />)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    rerender(<FeedbackScreenshotPicker {...props({ items: [b] })} />)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2) // оставшейся новую ссылку не делаем
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
