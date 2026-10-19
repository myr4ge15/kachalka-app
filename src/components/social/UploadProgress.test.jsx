// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import UploadProgress from './UploadProgress.jsx'

const MB = 1024 * 1024

describe('UploadProgress (fb_5ef64577)', () => {
  it('видео: полоса и «N из M МБ» с запятой', () => {
    render(<UploadProgress progress={{ loaded: 5.15 * MB, total: 12.4 * MB }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('Загружено 5,1 из 12,4 МБ')).toBeInTheDocument()
  })
  it('всё ушло — ждем сервер', () => {
    render(<UploadProgress progress={{ loaded: 3 * MB, total: 3 * MB }} />)
    expect(screen.getByText('Вложения загружены, отправляю обращение')).toBeInTheDocument()
  })
  it('мелкие вложения и нет прогресса — ничего', () => {
    const { container, rerender } = render(<UploadProgress progress={{ loaded: 0, total: 300 * 1024 }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<UploadProgress progress={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
