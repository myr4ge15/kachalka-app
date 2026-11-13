// @vitest-environment jsdom
// «Удалить аккаунт» в Настройках (П7, v6.18.0).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DeleteAccount from './DeleteAccount.jsx'
import * as auth from '../../lib/auth.js'
import { exportAllMyData } from '../../db/backup.js'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../../lib/auth.js', () => {
  class LoginError extends Error {
    constructor(code, message, retryAfter = null) { super(message); this.code = code; this.retryAfter = retryAfter }
  }
  return { deleteMyAccount: vi.fn(), LoginError }
})
vi.mock('../../db/backup.js', () => ({ exportAllMyData: vi.fn(async () => 7) }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))
afterEach(() => vi.clearAllMocks())

const USER = { id: 'u1', name: 'Вася', role: 'member' }
const openIt = () => fireEvent.click(screen.getByRole('button', { name: /Удалить аккаунт/ }))

describe('DeleteAccount', () => {
  it('админу пункт не показывается', () => {
    const { container } = render(<DeleteAccount user={{ ...USER, role: 'admin' }} onDeleted={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('без PIN не удаляет; можно сначала скачать данные', async () => {
    render(<DeleteAccount user={USER} onDeleted={vi.fn()} />)
    openIt()
    expect(screen.getByText(/удалится насовсем/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить навсегда' }))
    expect(screen.getByRole('alert')).toHaveTextContent('PIN')
    expect(auth.deleteMyAccount).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /скачать мои данные/ }))
    await vi.waitFor(() => expect(exportAllMyData).toHaveBeenCalledWith('u1', expect.any(String)))
  })

  it('PIN верный → onDeleted', async () => {
    vi.mocked(auth.deleteMyAccount).mockResolvedValue(true)
    const onDeleted = vi.fn()
    render(<DeleteAccount user={USER} onDeleted={onDeleted} />)
    openIt()
    fireEvent.change(screen.getByLabelText('PIN для подтверждения'), { target: { value: '48a26' } })
    expect(screen.getByLabelText('PIN для подтверждения').value).toBe('4826')
    fireEvent.click(screen.getByRole('button', { name: 'Удалить навсегда' }))
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(auth.deleteMyAccount).toHaveBeenCalledWith('u1', '4826')
  })

  it('неверный PIN — текст, поле очищено, onDeleted не зовется', async () => {
    vi.mocked(auth.deleteMyAccount).mockRejectedValue(new auth.LoginError('invalid', 'Неверный PIN'))
    const onDeleted = vi.fn()
    render(<DeleteAccount user={USER} onDeleted={onDeleted} />)
    openIt()
    fireEvent.change(screen.getByLabelText('PIN для подтверждения'), { target: { value: '1357' } })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить навсегда' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный PIN')
    expect(screen.getByLabelText('PIN для подтверждения').value).toBe('')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it.each([
    [new auth.LoginError('locked', 'Блокировка', 61), 'Попробуй через 2 мин.'],
    [new auth.LoginError('locked', 'Попробуй позже'), 'Попробуй позже'],
    [new Error('internal'), 'Не удалось удалить аккаунт.'],
  ])('при отказе удаления показывает %s и разрешает повторить', async (error, message) => {
    const request = Promise.withResolvers()
    vi.mocked(auth.deleteMyAccount).mockReturnValueOnce(request.promise)
    const onDeleted = vi.fn()
    render(<DeleteAccount user={USER} onDeleted={onDeleted} />)
    openIt()
    const pin = screen.getByLabelText('PIN для подтверждения')
    fireEvent.change(pin, { target: { value: '1357' } })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить навсегда' }))
    expect(screen.getByRole('button', { name: 'Удаляю…' })).toBeDisabled()
    await act(() => request.reject(error))
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(pin).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Удалить навсегда' })).toBeEnabled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('отмена очищает PIN, а повторное открытие не вызывает удаление', () => {
    render(<DeleteAccount user={USER} />)
    openIt()
    fireEvent.change(screen.getByLabelText('PIN для подтверждения'), { target: { value: '1357' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    openIt()
    expect(screen.getByLabelText('PIN для подтверждения')).toHaveValue('')
    expect(auth.deleteMyAccount).not.toHaveBeenCalled()
  })

  it('отмена выгрузки снимает блокировку формы без уведомления об успехе', async () => {
    const request = Promise.withResolvers()
    vi.mocked(exportAllMyData).mockReturnValueOnce(request.promise)
    render(<DeleteAccount user={USER} />)
    openIt()
    fireEvent.click(screen.getByRole('button', { name: /скачать мои данные/ }))
    expect(screen.getByRole('button', { name: 'Готовлю файл…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Удалить навсегда' })).toBeDisabled()
    await act(() => request.resolve(null))
    expect(screen.getByRole('button', { name: 'Удалить навсегда' })).toBeEnabled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it.each([new Error('Сбой записи'), 'Сбой записи'])('ошибка выгрузки %s видна и не блокирует форму', async (error) => {
    vi.mocked(exportAllMyData).mockRejectedValueOnce(error)
    render(<DeleteAccount user={USER} />)
    openIt()
    fireEvent.click(screen.getByRole('button', { name: /скачать мои данные/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({
      icon: 'alert', title: 'Не удалось выгрузить', sub: 'Сбой записи',
    }))
    expect(screen.getByRole('button', { name: 'Удалить навсегда' })).toBeEnabled()
  })
})
