// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import ShareInviteButton from './ShareInviteButton.jsx'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const text = 'Зову в kachalka-app\n\nhttps://example.test/#invite=test'
function tap() {
  render(<ShareInviteButton className="btn primary" text={text} />)
  fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }))
}

describe('отправка приглашения', () => {
  beforeEach(() => { navigator.share = vi.fn().mockResolvedValue(); vi.clearAllMocks() })
  afterEach(() => { delete navigator.share; delete navigator.canShare })

  it('сразу передает исходный PNG и всю подпись одним вызовом', async () => {
    navigator.canShare = vi.fn().mockReturnValue(true)
    tap()
    expect(navigator.share).toHaveBeenCalledTimes(1)
    const [payload] = navigator.share.mock.calls[0]
    expect(payload.text).toBe(text)
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0]).toMatchObject({ name: 'kachalka-app.png', type: 'image/png' })
    expect(navigator.canShare).toHaveBeenCalledWith(payload)
    const bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result))
      reader.onerror = reject
      reader.readAsArrayBuffer(payload.files[0])
    })
    expect(Buffer.from(bytes).equals(readFileSync('public/share-card.png'))).toBe(true)
  })

  it.each([false, undefined])('сохраняет текст со ссылкой без поддержки файлов (%s)', (support) => {
    if (support === false) navigator.canShare = () => false
    tap()
    expect(navigator.share).toHaveBeenCalledWith({ title: 'kachalka-app', text })
  })

  it('отмена не открывает меню заново', async () => {
    navigator.share.mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    tap()
    await navigator.share.mock.results[0].value.catch(() => {})
    expect(navigator.share).toHaveBeenCalledTimes(1)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('при ошибке подсказывает, как отправить текст', async () => {
    navigator.share.mockRejectedValue(new Error('failed'))
    tap()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: expect.stringContaining('Скопировать') })))
  })
})
